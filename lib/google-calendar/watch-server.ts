import "server-only";

import { randomUUID } from "crypto";

import { createServerSupabaseClient } from "@/lib/supabase";
import {
  getGoogleCalendarClientForUser,
  type SupabaseClient,
} from "@/lib/google-calendar/oauth-server";

type GoogleCalendarSyncStateRow = {
  google_account_id: string;
  calendar_id: string;
  watch_channel_id: string | null;
  watch_resource_id: string | null;
};

async function getSyncState(
  supabase: SupabaseClient,
  accountId: string,
  calendarId: string
): Promise<GoogleCalendarSyncStateRow | null> {
  const { data } = await supabase
    .from("google_calendar_sync_states")
    .select("google_account_id, calendar_id, watch_channel_id, watch_resource_id")
    .eq("google_account_id", accountId)
    .eq("calendar_id", calendarId)
    .maybeSingle();

  return (data as GoogleCalendarSyncStateRow | null) ?? null;
}

export async function startCalendarWatch(
  userId: string,
  calendarId: string,
  address: string,
  options?: { supabase?: SupabaseClient; redirectUri?: string; ttlMs?: number }
) {
  const supabase = options?.supabase ?? await createServerSupabaseClient();
  const { calendar, account } = await getGoogleCalendarClientForUser(userId, {
    supabase,
    redirectUri: options?.redirectUri,
  });

  const channelId = randomUUID();
  const channelToken = randomUUID();
  const expiration = Date.now() + (options?.ttlMs ?? 86_400_000);

  const res = await calendar.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address,
      token: channelToken,
      params: {
        ttl: Math.floor((options?.ttlMs ?? 86_400_000) / 1000).toString(),
      },
      expiration: expiration.toString(),
    },
  });

  await supabase
    .from("google_calendar_sync_states")
    .upsert(
      {
        google_account_id: account.id,
        calendar_id: calendarId,
        watch_channel_id: res.data.id ?? channelId,
        watch_channel_token: channelToken,
        watch_resource_id: res.data.resourceId ?? null,
        watch_expiration: res.data.expiration
          ? new Date(Number(res.data.expiration)).toISOString()
          : new Date(expiration).toISOString(),
        watch_status: "active",
        watch_ttl_seconds: Math.floor((options?.ttlMs ?? 86_400_000) / 1000),
        watch_checked_at: new Date().toISOString(),
      },
      { onConflict: "google_account_id,calendar_id" }
    );

  return {
    channelId: res.data.id ?? channelId,
    resourceId: res.data.resourceId ?? null,
    expiration: res.data.expiration ?? expiration,
  };
}

export async function stopCalendarWatch(
  userId: string,
  calendarId: string,
  options?: { supabase?: SupabaseClient; redirectUri?: string }
) {
  const supabase = options?.supabase ?? await createServerSupabaseClient();
  const { calendar, account } = await getGoogleCalendarClientForUser(userId, {
    supabase,
    redirectUri: options?.redirectUri,
  });

  const state = await getSyncState(supabase, account.id, calendarId);
  if (!state?.watch_channel_id || !state.watch_resource_id) {
    return { stopped: false, reason: "no-active-watch" };
  }

  try {
    await calendar.channels.stop({
      requestBody: {
        id: state.watch_channel_id,
        resourceId: state.watch_resource_id,
      },
    });
  } catch (error) {
    console.error("[googleCalendar] stop watch failed", error);
  }

  await supabase
    .from("google_calendar_sync_states")
    .update({
      watch_channel_id: null,
      watch_channel_token: null,
      watch_resource_id: null,
      watch_expiration: null,
      watch_status: "inactive",
      watch_checked_at: new Date().toISOString(),
    })
    .eq("google_account_id", account.id)
    .eq("calendar_id", calendarId);

  return { stopped: true };
}
