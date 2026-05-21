import "server-only";

import type { calendar_v3 } from "googleapis";
import type { GoogleCalendarEvent } from "@/lib/api-types/google-calendar";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  getGoogleCalendarClientForUser,
  hasCalendarWritePermission,
  type SupabaseClient,
} from "@/lib/google-calendar/oauth-server";
import {
  startCalendarWatch,
  stopCalendarWatch,
} from "@/lib/google-calendar/watch-server";
import { applyGoogleEventsToTaeskCards } from "@/lib/google-calendar/taesk-apply-server";
import { fetchEventsWithTokenFallback } from "@/lib/google-calendar/sync-flow-server";
export { startCalendarWatch, stopCalendarWatch };
export {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CALENDAR_READONLY_SCOPE,
  hasCalendarWritePermission,
  resolveGoogleRedirectUri,
  createGoogleOAuthClient,
  getGoogleCalendarClientForUser,
  GoogleCalendarNotConnectedError,
} from "@/lib/google-calendar/oauth-server";

const DEFAULT_DISPLAY_TZ = "Asia/Tokyo";
const PAST_WINDOW_DAYS = 28;   // 4 weeks
const FUTURE_WINDOW_DAYS = 84; // 12 weeks

type NormalizedGoogleEvent = GoogleCalendarEvent & {
  startUtc: string;
  endUtc: string;
  startDate: string | null;
  endDate: string | null;
  displayTz: string | null;
  status: string | null;
  location: string | null;
  attendees: Record<string, unknown>[] | null;
  conferenceData: Record<string, unknown> | null;
  etag: string | null;
  recurringEventId: string | null;
  originalStartTime: string | null;
  description: string | null;
  updatedAtGoogle: string | null;
  taeskCardId?: string | null;
  taeskUpdatedAt?: string | null;
};

type GoogleCalendarSyncStateRow = {
  google_account_id: string;
  calendar_id: string;
  sync_token: string | null;
  last_full_sync_at: string | null;
  last_synced_at: string | null;
  window_start: string | null;
  window_end: string | null;
  watch_channel_id: string | null;
  watch_channel_token: string | null;
  watch_resource_id: string | null;
  watch_expiration: string | null;
  watch_status: string | null;
  polling_disabled_until: string | null;
  p95_ingest_latency_ms: number | null;
  last_watch_at: string | null;
  watch_checked_at: string | null;
  watch_ttl_seconds: number | null;
  last_poll_started_at: string | null;
};

type CachedGoogleEventRow = {
  google_event_id: string;
  summary: string | null;
  start_utc: string;
  end_utc: string;
  is_all_day: boolean | null;
  calendar_id: string | null;
  html_link: string | null;
  status: string | null;
  display_tz: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  attendees: Record<string, unknown>[] | null;
  conference_data: Record<string, unknown> | null;
  etag: string | null;
  description: string | null;
};

const STALE_CACHE_MS = 5 * 60 * 1000;

type GoogleApiErrorShape = {
  code?: number;
  response?: { status?: number };
  message?: string;
};

function toGoogleApiError(error: unknown): GoogleApiErrorShape {
  if (!error || typeof error !== "object") return {};
  return error as GoogleApiErrorShape;
}

function buildAllDayIso(dateStr: string, timeZone: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map((part) => Number(part));
    const utcMidnight = Date.UTC(year, (month ?? 1) - 1, day ?? 1, 0, 0, 0);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = formatter.formatToParts(new Date(utcMidnight));
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    const zoned = Date.UTC(
      Number(get("year") ?? 1970),
      Number(get("month") ?? 1) - 1,
      Number(get("day") ?? 1),
      Number(get("hour") ?? 0),
      Number(get("minute") ?? 0),
      Number(get("second") ?? 0)
    );
    const offsetMs = zoned - utcMidnight;
    const target = utcMidnight - offsetMs;
    return new Date(target).toISOString();
  } catch {
    // Fallback to UTC midnight if TZ parsing fails
    return `${dateStr}T00:00:00Z`;
  }
}

function coerceDateTime(value?: calendar_v3.Schema$EventDateTime | null): { iso: string; isAllDay: boolean; date: string | null; timeZone: string | null } | null {
  if (!value) return null;
  if (value.dateTime) {
    return {
      iso: value.dateTime,
      isAllDay: false,
      date: value.dateTime.split("T")?.[0] ?? null,
      timeZone: value.timeZone ?? null,
    };
  }
  if (value.date) {
    const timeZone = value.timeZone ?? DEFAULT_DISPLAY_TZ;
    const iso = buildAllDayIso(value.date, timeZone);
    return { iso, isAllDay: true, date: value.date, timeZone };
  }
  return null;
}

function mapGoogleEvent(item: calendar_v3.Schema$Event, calendarId: string): NormalizedGoogleEvent | null {
  const start = coerceDateTime(item.start);
  const end = coerceDateTime(item.end);
  if (!start || !end) return null;

  const displayTz = start.timeZone
    ?? end.timeZone
    ?? item.start?.timeZone
    ?? item.end?.timeZone
    ?? DEFAULT_DISPLAY_TZ;

  const startUtc = new Date(start.iso).toISOString();
  const endUtc = new Date(end.iso).toISOString();

  const id = item.id ?? item.iCalUID ?? `${start.iso}-${end.iso}`;
  const title = item.summary ?? "Untitled event";

  const privateProps = item.extendedProperties?.private ?? {};
  const taeskCardId = typeof privateProps === "object"
    ? privateProps.taeskCardId ?? privateProps.taeskCardID ?? null
    : null;
  const taeskUpdatedAt = typeof privateProps === "object"
    ? privateProps.taeskUpdatedAt ?? null
    : null;

  return {
    id,
    title,
    start: start.iso,
    end: end.iso,
    startUtc,
    endUtc,
    isAllDay: start.isAllDay || Boolean(item.start?.date),
    source: "google_calendar",
    calendarId: item.organizer?.email ?? item.creator?.email ?? calendarId,
    htmlLink: item.htmlLink ?? null,
    status: item.status ?? "confirmed",
    displayTz,
    startDate: item.start?.date ?? (start.isAllDay ? start.date ?? null : null),
    endDate: item.end?.date ?? (end.isAllDay ? end.date ?? null : null),
    location: item.location ?? null,
    attendees: (item.attendees as Record<string, unknown>[] | null | undefined) ?? null,
    conferenceData: (item.conferenceData as Record<string, unknown> | null | undefined) ?? null,
    etag: item.etag ?? null,
    recurringEventId: item.recurringEventId ?? null,
    originalStartTime: item.originalStartTime?.dateTime ?? item.originalStartTime?.date ?? null,
    description: item.description ?? null,
    updatedAtGoogle: item.updated ? new Date(item.updated).toISOString() : null,
    taeskCardId,
    taeskUpdatedAt: taeskUpdatedAt ? new Date(taeskUpdatedAt).toISOString() : null,
  };
}

async function persistGoogleEvents(
  supabase: SupabaseClient,
  accountId: string,
  calendarId: string,
  events: NormalizedGoogleEvent[]
) {
  if (!events.length) return;

  const rows = events.map((event) => ({
    google_account_id: accountId,
    calendar_id: calendarId,
    google_event_id: event.id,
    recurring_event_id: event.recurringEventId ?? null,
    original_start_time: event.originalStartTime ? new Date(event.originalStartTime).toISOString() : null,
    summary: event.title,
    description: event.description,
    location: event.location,
    status: event.status,
    is_all_day: event.isAllDay,
    display_tz: event.displayTz,
    start_date: event.startDate,
    end_date: event.endDate,
    start_utc: event.startUtc,
    end_utc: event.endUtc,
    html_link: event.htmlLink,
    conference_data: event.conferenceData,
    attendees: event.attendees,
    raw: null,
    etag: event.etag,
    updated_at_google: event.updatedAtGoogle,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("google_calendar_events")
    .upsert(rows, { onConflict: "google_account_id,google_event_id" });

  if (error) {
    console.error("[googleCalendar] failed to persist google_calendar_events", error);
  }
}

async function removeCancelledEvents(
  supabase: SupabaseClient,
  accountId: string,
  calendarId: string,
  events: NormalizedGoogleEvent[]
) {
  const cancelledIds = events
    .filter((e) => e.status === "cancelled")
    .map((e) => e.id);
  if (!cancelledIds.length) return;

  const { error } = await supabase
    .from("google_calendar_events")
    .delete()
    .eq("google_account_id", accountId)
    .eq("calendar_id", calendarId)
    .in("google_event_id", cancelledIds);

  if (error) {
    console.error("[googleCalendar] failed to delete cancelled events", error);
  }

  const { error: syncUpdateError } = await supabase
    .from("calendar_sync")
    .update({
      status: "unlinked",
      google_event_id: null,
      etag: null,
      last_synced_at: new Date().toISOString(),
    })
    .eq("google_account_id", accountId)
    .eq("calendar_id", calendarId)
    .in("google_event_id", cancelledIds);

  if (syncUpdateError) {
    console.error("[googleCalendar] failed to downgrade cancelled sync records", syncUpdateError);
  }
}

function shouldSkipSelfUpdate(event: NormalizedGoogleEvent): boolean {
  const taeskUpdatedMs = event.taeskUpdatedAt ? Date.parse(event.taeskUpdatedAt) : NaN;
  const googleUpdatedMs = event.updatedAtGoogle ? Date.parse(event.updatedAtGoogle) : NaN;
  if (!Number.isFinite(taeskUpdatedMs) || !Number.isFinite(googleUpdatedMs)) return false;
  // Skip only if the Google update is effectively the same write we just made (within 30s window)
  const diff = googleUpdatedMs - taeskUpdatedMs;
  return diff >= 0 && diff <= 30_000;
}

async function pruneCacheWindow(
  supabase: SupabaseClient,
  accountId: string,
  calendarId: string,
  now: Date
) {
  const minDate = new Date(now.getTime() - PAST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const maxDate = new Date(now.getTime() + FUTURE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("google_calendar_events")
    .delete()
    .eq("google_account_id", accountId)
    .eq("calendar_id", calendarId)
    .lt("end_utc", minDate)
    .or(`start_utc.gt.${maxDate}`);

  if (error) {
    console.error("[googleCalendar] failed to prune cache window", error);
  }
}

function rowToGoogleCalendarEvent(row: CachedGoogleEventRow): GoogleCalendarEvent {
  return {
    id: row.google_event_id,
    title: row.summary ?? "Untitled event",
    start: row.start_utc,
    end: row.end_utc,
    startUtc: row.start_utc,
    endUtc: row.end_utc,
    isAllDay: Boolean(row.is_all_day),
    source: "google_calendar",
    calendarId: row.calendar_id,
    htmlLink: row.html_link,
    status: row.status,
    displayTz: row.display_tz,
    startDate: row.start_date,
    endDate: row.end_date,
    location: row.location,
    attendees: row.attendees,
    conferenceData: row.conference_data,
    etag: row.etag,
    description: row.description,
  };
}

async function fetchCachedEvents(
  supabase: SupabaseClient,
  accountId: string,
  calendarId: string,
  start: Date,
  end: Date
): Promise<GoogleCalendarEvent[]> {
  const { data, error } = await supabase
    .from("google_calendar_events")
    .select("*")
    .eq("google_account_id", accountId)
    .eq("calendar_id", calendarId)
    .lt("start_utc", end.toISOString())
    .gt("end_utc", start.toISOString())
    .neq("status", "cancelled")
    .order("start_utc", { ascending: true });

  if (error) {
    console.error("[googleCalendar] failed to load cached events", error);
    return [];
  }

  return (data ?? []).map(rowToGoogleCalendarEvent);
}

function isStaleLastSyncedAt(lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt) return true;
  const syncedMs = Date.parse(lastSyncedAt);
  return !Number.isFinite(syncedMs) || Date.now() - syncedMs > STALE_CACHE_MS;
}

async function getSyncState(
  supabase: SupabaseClient,
  accountId: string,
  calendarId: string
): Promise<GoogleCalendarSyncStateRow | null> {
  const { data, error } = await supabase
    .from("google_calendar_sync_states")
    .select("*")
    .eq("google_account_id", accountId)
    .eq("calendar_id", calendarId)
    .maybeSingle();

  if (error) {
    console.error("[googleCalendar] failed to load sync state", error);
    return null;
  }

  return data as GoogleCalendarSyncStateRow | null;
}

async function persistSyncState(
  supabase: SupabaseClient,
  accountId: string,
  calendarId: string,
  params: { syncToken?: string | null; windowStart?: Date; windowEnd?: Date }
) {
  const payload = {
    google_account_id: accountId,
    calendar_id: calendarId,
    sync_token: params.syncToken ?? null,
    last_synced_at: new Date().toISOString(),
    last_full_sync_at: params.syncToken ? new Date().toISOString() : null,
    window_start: params.windowStart ? params.windowStart.toISOString() : null,
    window_end: params.windowEnd ? params.windowEnd.toISOString() : null,
    watch_checked_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("google_calendar_sync_states")
    .upsert(payload, { onConflict: "google_account_id,calendar_id" });

  if (error) {
    console.error("[googleCalendar] failed to persist sync state", error);
  }
}

async function clearSyncToken(
  supabase: SupabaseClient,
  accountId: string,
  calendarId: string
) {
  const { error } = await supabase
    .from("google_calendar_sync_states")
    .update({ sync_token: null, watch_status: "inactive" })
    .eq("google_account_id", accountId)
    .eq("calendar_id", calendarId);

  if (error) {
    console.error("[googleCalendar] failed to clear sync token", error);
  }
}

function isRangeCovered(
  start: Date,
  end: Date,
  windowStartIso: string | null,
  windowEndIso: string | null
): boolean {
  if (!windowStartIso || !windowEndIso) return false;
  const windowStart = new Date(windowStartIso).getTime();
  const windowEnd = new Date(windowEndIso).getTime();
  return windowStart <= start.getTime() && windowEnd >= end.getTime();
}

async function fetchAndCacheRange(
  calendar: calendar_v3.Calendar,
  supabase: SupabaseClient,
  accountId: string,
  calendarId: string,
  start: Date,
  end: Date
): Promise<NormalizedGoogleEvent[]> {
  const now = new Date();
  const expandedStart = new Date(Math.min(start.getTime(), now.getTime() - PAST_WINDOW_DAYS * 24 * 60 * 60 * 1000));
  const expandedEnd = new Date(Math.max(end.getTime(), now.getTime() + FUTURE_WINDOW_DAYS * 24 * 60 * 60 * 1000));

  const response = await calendar.events.list({
    calendarId,
    timeMin: expandedStart.toISOString(),
    timeMax: expandedEnd.toISOString(),
    singleEvents: true,
    showDeleted: true,
    orderBy: "startTime",
    maxResults: 2500,
  });

  const items = response.data.items ?? [];
  const normalizedEventsAll = items
    .map((item) => mapGoogleEvent(item, calendarId))
    .filter((event): event is NormalizedGoogleEvent => Boolean(event));

  const normalizedEvents = normalizedEventsAll
    .filter((event) => event.status !== "cancelled")
    .filter((event) => !shouldSkipSelfUpdate(event));

  if (normalizedEvents.length) {
    await persistGoogleEvents(supabase, accountId, calendarId, normalizedEvents);
  }

  await removeCancelledEvents(supabase, accountId, calendarId, normalizedEventsAll);

  const nextSyncToken = response.data.nextSyncToken;
  if (nextSyncToken) {
    await persistSyncState(supabase, accountId, calendarId, {
      syncToken: nextSyncToken,
      windowStart: expandedStart,
      windowEnd: expandedEnd,
    });
  } else {
    console.warn("[googleCalendar] full sync finished but no nextSyncToken returned", {
      accountId,
      calendarId,
      windowStart: expandedStart.toISOString(),
      windowEnd: expandedEnd.toISOString(),
      itemCount: normalizedEventsAll.length,
    });
  }

  await pruneCacheWindow(supabase, accountId, calendarId, now);

  return normalizedEvents;
}

async function fetchWithSyncToken(
  calendar: calendar_v3.Calendar,
  supabase: SupabaseClient,
  accountId: string,
  calendarId: string,
  syncToken: string
): Promise<NormalizedGoogleEvent[]> {
  const now = new Date();
  const response = await calendar.events.list({
    calendarId,
    syncToken,
    showDeleted: true,
    maxResults: 2500,
    singleEvents: true,
  });

  const items = response.data.items ?? [];
  const normalizedEventsAll = items
    .map((item) => mapGoogleEvent(item, calendarId))
    .filter((event): event is NormalizedGoogleEvent => Boolean(event));

  const normalizedEvents = normalizedEventsAll
    .filter((event) => event.status !== "cancelled")
    .filter((event) => !shouldSkipSelfUpdate(event));

  if (normalizedEvents.length) {
    await persistGoogleEvents(supabase, accountId, calendarId, normalizedEvents);
  }

  await removeCancelledEvents(supabase, accountId, calendarId, normalizedEventsAll);

  const nextSyncToken = response.data.nextSyncToken;
  if (nextSyncToken) {
    await persistSyncState(supabase, accountId, calendarId, {
      syncToken: nextSyncToken,
    });
  } else {
    console.warn("[googleCalendar] incremental sync finished but no nextSyncToken returned", {
      accountId,
      calendarId,
      itemCount: normalizedEventsAll.length,
    });
  }

  await pruneCacheWindow(supabase, accountId, calendarId, now);

  return normalizedEvents;
}

function needsWatchRenewal(state: GoogleCalendarSyncStateRow | null): boolean {
  if (!state?.watch_expiration) return true;
  const exp = new Date(state.watch_expiration).getTime();
  const ttlMs = (state.watch_ttl_seconds ?? 86_400) * 1000;
  const remaining = exp - Date.now();
  const ratio = remaining / ttlMs;
  return ratio <= 0.3;
}

async function markFallbackPolling(
  supabase: SupabaseClient,
  state: GoogleCalendarSyncStateRow,
  reason: string
) {
  await supabase
    .from("google_calendar_sync_states")
    .update({
      watch_status: "polling",
      last_poll_started_at: new Date().toISOString(),
    })
    .eq("google_account_id", state.google_account_id)
    .eq("calendar_id", state.calendar_id);

  await supabase.from("google_calendar_sync_logs").insert({
    google_account_id: state.google_account_id,
    calendar_id: state.calendar_id,
    google_event_id: null,
    action: "polling",
    detail: { reason },
  });
}

async function markWatchHeartbeat(
  supabase: SupabaseClient,
  state: GoogleCalendarSyncStateRow,
  nowIso: string
) {
  await supabase
    .from("google_calendar_sync_states")
    .update({
      last_watch_at: nowIso,
      watch_status: "active",
    })
    .eq("google_account_id", state.google_account_id)
    .eq("calendar_id", state.calendar_id);
}

export async function syncGoogleCalendarToTaesk(
  userId: string,
  calendarId?: string,
  options?: { supabase?: SupabaseClient; reason?: string }
): Promise<{ matched: number; updated: number }> {
  const supabase = options?.supabase ?? (await createServerSupabaseClient());
  const { calendar, account } = await getGoogleCalendarClientForUser(userId, { supabase });
  const targetCalendarId = calendarId ?? "primary";
  const now = new Date();
  const windowStart = new Date(now.getTime() - PAST_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + FUTURE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const syncState = await getSyncState(supabase, account.id, targetCalendarId);
  const events = await fetchEventsWithTokenFallback<NormalizedGoogleEvent>({
    syncToken: syncState?.sync_token,
    fetchWithSyncToken: (token) =>
      fetchWithSyncToken(calendar, supabase, account.id, targetCalendarId, token),
    clearSyncToken: () => clearSyncToken(supabase, account.id, targetCalendarId),
    fetchAndCacheRange: () =>
      fetchAndCacheRange(calendar, supabase, account.id, targetCalendarId, windowStart, windowEnd),
    toGoogleApiError,
    onSyncTokenError: (error) => {
      console.error("[googleCalendar] syncToken fetch failed", error);
    },
  });

  return await applyGoogleEventsToTaeskCards({
    supabase,
    accountId: account.id,
    calendarId: targetCalendarId,
    events,
    defaultDisplayTz: DEFAULT_DISPLAY_TZ,
  });
}

export async function listEventsForRange(
  userId: string,
  start: Date,
  end: Date,
  options?: {
    calendarId?: string;
    supabase?: SupabaseClient;
    redirectUri?: string;
    origin?: string;
    webhookAddress?: string;
    syncCardsOnFetch?: boolean;
  }
): Promise<{ events: GoogleCalendarEvent[]; canWrite: boolean }> {
  const supabase = options?.supabase ?? await createServerSupabaseClient();
  const { calendar, account } = await getGoogleCalendarClientForUser(userId, {
    supabase,
    redirectUri: options?.redirectUri,
  });

  const calendarId = options?.calendarId ?? "primary";
  const syncState = await getSyncState(supabase, account.id, calendarId);

  // Watch renewal check
  if (needsWatchRenewal(syncState)) {
    try {
      const address =
        options?.webhookAddress
        ?? process.env.GOOGLE_CALENDAR_WEBHOOK_URL
        ?? (options?.origin ? `${options.origin}/api/integrations/google-calendar/webhook` : null);

      if (!address) {
        console.warn("[googleCalendar] watch renewal skipped (no origin / webhook url)", { calendarId });
      } else {
        let isLocalhost = false;
        try {
          const u = new URL(address);
          isLocalhost = u.hostname === "localhost" || u.hostname === "127.0.0.1";
        } catch {
          // If parsing fails, let Google validate it and surface the error via logs.
        }

        if (isLocalhost && !process.env.GOOGLE_CALENDAR_WEBHOOK_URL) {
          console.warn("[googleCalendar] watch renewal skipped (localhost origin; set GOOGLE_CALENDAR_WEBHOOK_URL for tunnels/prod)", { calendarId, address });
        } else {
          await startCalendarWatch(userId, calendarId, address, { supabase });
        }
      }
    } catch (err) {
      console.error("[googleCalendar] watch renewal failed", err);
    }
  }

  const recentEnough = syncState?.last_synced_at
    ? Date.now() - new Date(syncState.last_synced_at).getTime() < 5 * 60 * 1000
    : false;
  const covered = syncState ? isRangeCovered(start, end, syncState.window_start, syncState.window_end) : false;
  const hasSyncToken = Boolean(syncState?.sync_token);
  const syncCardsOnFetch = options?.syncCardsOnFetch ?? true;
  let deltaEvents: NormalizedGoogleEvent[] = [];

  // Cache-first: if recent and window covers the request, serve cached.
  // Try syncToken diff first
  if (hasSyncToken && syncState?.sync_token) {
    try {
      deltaEvents = await fetchWithSyncToken(calendar, supabase, account.id, calendarId, syncState.sync_token);
    } catch (err) {
      const parsed = toGoogleApiError(err);
      const status = parsed.code || parsed.response?.status;
      if (status === 410) {
        await clearSyncToken(supabase, account.id, calendarId);
        // fall through to full fetch below
      } else {
        console.error("[googleCalendar] syncToken fetch failed", err);
      }
    }
  }

  // If we just refreshed via syncToken and windowはカバー済み、最新キャッシュを返す
  if (recentEnough && covered && hasSyncToken) {
    if (syncCardsOnFetch && deltaEvents.length) {
      await applyGoogleEventsToTaeskCards({
        supabase,
        accountId: account.id,
        calendarId,
        events: deltaEvents,
        defaultDisplayTz: DEFAULT_DISPLAY_TZ,
      });
    }
    const cached = await fetchCachedEvents(supabase, account.id, calendarId, start, end);
    const canWriteCached = hasCalendarWritePermission(account.scope);
    return { events: cached, canWrite: canWriteCached };
  }

  // Ensure window coverage by full fetch
  const fullEvents = await fetchAndCacheRange(calendar, supabase, account.id, calendarId, start, end);
  if (syncCardsOnFetch && fullEvents.length) {
    await applyGoogleEventsToTaeskCards({
      supabase,
      accountId: account.id,
      calendarId,
      events: fullEvents,
      defaultDisplayTz: DEFAULT_DISPLAY_TZ,
    });
  }

  const events = await fetchCachedEvents(supabase, account.id, calendarId, start, end);
  const canWrite = hasCalendarWritePermission(account.scope);

  return { events, canWrite };
}

export async function listCachedEventsForRange(
  userId: string,
  start: Date,
  end: Date,
  options?: { calendarId?: string; supabase?: SupabaseClient }
): Promise<{ events: GoogleCalendarEvent[]; canWrite: boolean }> {
  const supabase = options?.supabase ?? await createServerSupabaseClient();
  const { account } = await getGoogleCalendarClientForUser(userId, { supabase });
  const calendarId = options?.calendarId ?? "primary";
  const events = await fetchCachedEvents(supabase, account.id, calendarId, start, end);
  const canWrite = hasCalendarWritePermission(account.scope);
  return { events, canWrite };
}

export async function listCachedEventsForRangeDbOnly(
  userId: string,
  start: Date,
  end: Date,
  options?: { calendarId?: string; supabase?: SupabaseClient }
): Promise<{
  connected: boolean;
  events: GoogleCalendarEvent[];
  canWrite: boolean;
  lastSyncedAt: string | null;
  stale: boolean;
}> {
  const supabase = options?.supabase ?? await createServerSupabaseClient();
  const { data: account, error: accountError } = await supabase
    .from("google_calendar_accounts")
    .select("id, scope")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (accountError) {
    console.error("[googleCalendar] failed to load cached account", accountError);
    throw accountError;
  }

  if (!account) {
    return {
      connected: false,
      events: [],
      canWrite: false,
      lastSyncedAt: null,
      stale: true,
    };
  }

  const calendarId = options?.calendarId ?? "primary";
  const syncState = await getSyncState(supabase, account.id, calendarId);
  const lastSyncedAt = syncState?.last_synced_at ?? null;
  const events = await fetchCachedEvents(supabase, account.id, calendarId, start, end);

  return {
    connected: true,
    events,
    canWrite: hasCalendarWritePermission(account.scope),
    lastSyncedAt,
    stale: isStaleLastSyncedAt(lastSyncedAt),
  };
}

export async function disconnectGoogleCalendarAccount(userId: string, supabase?: SupabaseClient) {
  const client = supabase ?? await createServerSupabaseClient();
  const { error } = await client
    .from("google_calendar_accounts")
    .delete()
    .eq("user_id", userId);

  if (error) {
    console.error("[googleCalendar] failed to remove account", error);
  }
}
