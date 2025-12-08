import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { getGoogleCalendarClientForUser, startCalendarWatch, stopCalendarWatch } from "@/lib/googleCalendarServer";

export const runtime = "nodejs";

const MIN_POLLING_THRESHOLD_MS = 60_000; // floor for p95*3 fallback

function resolveWebhookAddress(origin: string) {
  if (process.env.GOOGLE_CALENDAR_WEBHOOK_URL) return process.env.GOOGLE_CALENDAR_WEBHOOK_URL;
  return `${origin}/api/integrations/google-calendar/webhook`;
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }

  const calendarId = request.nextUrl.searchParams.get("calendarId") ?? "primary";
  const origin = request.nextUrl.origin;

  const { account } = await getGoogleCalendarClientForUser(user.id, { supabase });
  const { data: state } = await supabase
    .from("google_calendar_sync_states")
    .select("*")
    .eq("google_account_id", account.id)
    .eq("calendar_id", calendarId)
    .maybeSingle();

  const now = Date.now();
  let currentState = state;

  // Expiration-based renewal (30% 残存で再作成)
  if (state?.watch_expiration) {
    const exp = new Date(state.watch_expiration).getTime();
    const ttlMs = (state.watch_ttl_seconds ?? 86_400) * 1000;
    const remainingRatio = (exp - now) / ttlMs;
    if (remainingRatio <= 0.3) {
      const address = resolveWebhookAddress(origin);
      await stopCalendarWatch(user.id, calendarId, { supabase });
      await startCalendarWatch(user.id, calendarId, address, { supabase });
      const { data: refreshed } = await supabase
        .from("google_calendar_sync_states")
        .select("*")
        .eq("google_account_id", account.id)
        .eq("calendar_id", calendarId)
        .maybeSingle();
      currentState = refreshed;
    }
  }

  // p95×3 無更新でポーリング切替
  const staleThresholdMs = Math.max(MIN_POLLING_THRESHOLD_MS, ((currentState?.p95_ingest_latency_ms ?? 60_000) * 3));
  const lastWatchAt = currentState?.last_watch_at ? new Date(currentState.last_watch_at).getTime() : null;
  if (lastWatchAt && now - lastWatchAt > staleThresholdMs) {
    await supabase
      .from("google_calendar_sync_states")
      .update({ watch_status: "polling", last_poll_started_at: new Date().toISOString() })
      .eq("google_account_id", account.id)
      .eq("calendar_id", calendarId);
  }

  const { data: latestState } = await supabase
    .from("google_calendar_sync_states")
    .select("*")
    .eq("google_account_id", account.id)
    .eq("calendar_id", calendarId)
    .maybeSingle();

  return NextResponse.json({ success: true, state: latestState });
}
