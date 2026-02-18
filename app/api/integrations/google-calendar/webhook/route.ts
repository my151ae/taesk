import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/server/supabaseAdmin";
import { syncGoogleCalendarToTaesk } from "@/lib/googleCalendarServer";
import { sanitizeProviderError } from "@/lib/server/log-sanitizer";
import { withErrorHandling } from "@/lib/server/with-error-handling";

export const runtime = "nodejs";

const postHandler = async (request: NextRequest) => {
  // Google sends headers only; body is usually empty. We just ack and log minimal info.
  const channelId = request.headers.get("x-goog-channel-id") ?? null;
  const channelToken = request.headers.get("x-goog-channel-token") ?? null;
  const resourceId = request.headers.get("x-goog-resource-id") ?? null;
  const resourceState = request.headers.get("x-goog-resource-state") ?? null;
  const messageNumber = request.headers.get("x-goog-message-number") ?? null;
  const sync = request.headers.get("x-goog-changed") ?? null;
  const nowIso = new Date().toISOString();

  console.log(`[GoogleWebhook] Received: channel=${channelId} resource=${resourceId} state=${resourceState}`);

  try {
    const supabase = createServiceRoleSupabaseClient();
    if (channelId) {
      const { data: state, error: stateError } = await supabase
        .from("google_calendar_sync_states")
        .select("google_account_id, calendar_id, watch_channel_token, watch_resource_id")
        .eq("watch_channel_id", channelId)
        .maybeSingle();

      if (stateError) {
        console.error("[googleCalendar/webhook] failed to load state", stateError);
      }

      // 確認用に channelId と resourceId をログ出し（セキュア情報は含めない）
      console.log("[googleCalendar/webhook] incoming", {
        channelId,
        hasChannelToken: Boolean(channelToken),
        resourceId,
        resourceState,
        messageNumber,
      });

      // Reject spoofed callbacks: require channel token + resource id match.
      if (
        !state ||
        !state.google_account_id ||
        !state.watch_channel_token ||
        channelToken !== state.watch_channel_token ||
        (state.watch_resource_id && resourceId !== state.watch_resource_id)
      ) {
        console.warn("[googleCalendar/webhook] rejected callback due to token/resource mismatch", {
          channelId,
          hasState: Boolean(state),
          hasStoredToken: Boolean(state?.watch_channel_token),
          hasIncomingToken: Boolean(channelToken),
          resourceId,
        });
        return NextResponse.json({ ok: false, error: "UNAUTHORIZED_WEBHOOK" }, { status: 401 });
      }

      if (messageNumber) {
        const { data: duplicate } = await supabase
          .from("google_calendar_sync_logs")
          .select("id")
          .eq("channel_id", channelId)
          .eq("message_number", messageNumber)
          .maybeSingle();

        if (duplicate?.id) {
          console.warn("[googleCalendar/webhook] duplicate message ignored", {
            channelId,
            messageNumber,
          });
          return NextResponse.json({ ok: true, duplicate: true });
        }
      }

      if (state?.google_account_id) {
        const { error: insertError } = await supabase.from("google_calendar_sync_logs").insert({
          google_account_id: state.google_account_id,
          calendar_id: state.calendar_id,
          google_event_id: null,
          action: "watch",
          detail: {
            channelId,
            resourceId,
            resourceState,
            messageNumber,
            changed: sync,
          },
          channel_id: channelId,
          message_number: messageNumber,
        });

        if (insertError) {
          console.error("[googleCalendar/webhook] failed to insert log", insertError);
        }

        const { error: updateError } = await supabase
          .from("google_calendar_sync_states")
          .update({
            last_watch_at: nowIso,
            watch_status: "active",
          })
          .eq("google_account_id", state.google_account_id)
          .eq("calendar_id", state.calendar_id);

        if (updateError) {
          console.error("[googleCalendar/webhook] failed to update state", updateError);
        }

        const { data: account } = await supabase
          .from("google_calendar_accounts")
          .select("user_id")
          .eq("id", state.google_account_id)
          .maybeSingle();

        if (account?.user_id) {
          try {
            await syncGoogleCalendarToTaesk(account.user_id, state.calendar_id ?? "primary", { supabase, reason: "webhook" });
          } catch (syncError) {
            console.error("[googleCalendar/webhook] pull sync failed", sanitizeProviderError(syncError));
          }
        }
      }
    }
  } catch (error) {
    console.error("[googleCalendar/webhook] failed to record", sanitizeProviderError(error));
    // Do not fail the ack.
  }

  return NextResponse.json({ ok: true });
};

export const POST = withErrorHandling(postHandler, "google-calendar-webhook-post");
