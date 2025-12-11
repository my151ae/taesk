import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/server/supabaseAdmin";
import { syncGoogleCalendarToTaesk } from "@/lib/googleCalendarServer";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // Google sends headers only; body is usually empty. We just ack and log minimal info.
  const channelId = request.headers.get("x-goog-channel-id") ?? null;
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
        .select("google_account_id, calendar_id")
        .eq("watch_channel_id", channelId)
        .maybeSingle();

      if (stateError) {
        console.error("[googleCalendar/webhook] failed to load state", stateError);
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
            console.error("[googleCalendar/webhook] pull sync failed", syncError);
          }
        }
      }
    }
  } catch (error) {
    console.error("[googleCalendar/webhook] failed to record", error);
    // Do not fail the ack.
  }

  return NextResponse.json({ ok: true });
}
