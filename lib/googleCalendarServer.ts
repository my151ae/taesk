import "server-only";

import { google, type calendar_v3 } from "googleapis";
import type { GoogleCalendarEvent } from "@/lib/api-types/google-calendar";
import { createServerSupabaseClient } from "@/lib/supabase";
import { randomUUID } from "crypto";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const DEFAULT_DISPLAY_TZ = "Asia/Tokyo";


type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type GoogleAccountRow = {
  id: string;
  user_id: string;
  google_sub: string;
  email: string;
  access_token: string;
  refresh_token: string;
  scope: string;
  token_expires_at: string;
};

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

export function hasCalendarWritePermission(scope: string): boolean {
  return scope.includes("calendar.events") || scope.includes("https://www.googleapis.com/auth/calendar") || scope.includes("https://www.googleapis.com/auth/calendar.events");
}

export class GoogleCalendarNotConnectedError extends Error {
  code = "GOOGLE_CALENDAR_NOT_CONNECTED";
  constructor(message?: string) {
    super(message ?? "Google Calendar is not connected");
    this.name = "GoogleCalendarNotConnectedError";
  }
}

export function resolveGoogleRedirectUri(origin?: string) {
  if (!origin) {
    if (process.env.NEXT_PUBLIC_APP_URL) origin = process.env.NEXT_PUBLIC_APP_URL;
    else if (process.env.NEXT_PUBLIC_SITE_URL) origin = process.env.NEXT_PUBLIC_SITE_URL;
    else if (process.env.VERCEL_URL) origin = `https://${process.env.VERCEL_URL}`;
    else origin = "http://localhost:3000";
  }
  const url = new URL("/api/integrations/google-calendar/callback", origin);
  return url.toString();
}

function assertGoogleEnv() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
  }
}

export function createGoogleOAuthClient(redirectUri?: string) {
  assertGoogleEnv();
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

function isExpired(tokenExpiresAt: string) {
  const expiresMs = new Date(tokenExpiresAt).getTime();
  if (!Number.isFinite(expiresMs)) return true;
  return expiresMs <= Date.now() + TOKEN_EXPIRY_BUFFER_MS;
}

async function fetchAccount(supabase: SupabaseClient, userId: string): Promise<GoogleAccountRow | null> {
  const { data, error } = await supabase
    .from("google_calendar_accounts")
    .select(
      "id, user_id, google_sub, email, access_token, refresh_token, scope, token_expires_at"
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[googleCalendar] failed to load account", error);
    throw error;
  }

  return data ?? null;
}

async function updateAccountTokens(
  supabase: SupabaseClient,
  account: GoogleAccountRow,
  tokens: {
    access_token: string;
    refresh_token: string;
    scope: string;
    token_expires_at: string;
  }
) {
  const { error } = await supabase
    .from("google_calendar_accounts")
    .update(tokens)
    .eq("user_id", account.user_id)
    .eq("google_sub", account.google_sub);

  if (error) {
    console.error("[googleCalendar] failed to update tokens", error);
    throw error;
  }
}

async function ensureAuthorizedClient(
  account: GoogleAccountRow,
  supabase: SupabaseClient,
  redirectUri?: string
) {
  const oauth2Client = createGoogleOAuthClient(redirectUri);
  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expiry_date: new Date(account.token_expires_at).getTime(),
  });

  if (!isExpired(account.token_expires_at)) {
    return oauth2Client;
  }

  // Refresh token if expired or close to expiry
  const { credentials } = await oauth2Client.refreshAccessToken();
  const nextAccess = credentials.access_token ?? account.access_token;
  const nextRefresh = credentials.refresh_token ?? account.refresh_token;
  const expiresAtIso = credentials.expiry_date
    ? new Date(credentials.expiry_date).toISOString()
    : account.token_expires_at;
  const scope = credentials.scope ?? account.scope;

  await updateAccountTokens(supabase, account, {
    access_token: nextAccess,
    refresh_token: nextRefresh,
    scope,
    token_expires_at: expiresAtIso,
  });

  oauth2Client.setCredentials({
    access_token: nextAccess,
    refresh_token: nextRefresh,
    expiry_date: credentials.expiry_date ?? new Date(expiresAtIso).getTime(),
  });

  return oauth2Client;
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
    ?? item.timeZone
    ?? DEFAULT_DISPLAY_TZ;

  const startUtc = new Date(start.iso).toISOString();
  const endUtc = new Date(end.iso).toISOString();

  const id = item.id ?? item.iCalUID ?? `${start.iso}-${end.iso}`;
  const title = item.summary ?? "Untitled event";

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
}

function rowToGoogleCalendarEvent(row: any): GoogleCalendarEvent {
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
  const expiration = Date.now() + (options?.ttlMs ?? 86_400_000); // default 24h

  const res = await calendar.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address,
      token: account.id,
      params: {
        ttl: Math.floor((options?.ttlMs ?? 86_400_000) / 1000),
      },
      expiration,
    },
  });

  await supabase
    .from("google_calendar_sync_states")
    .upsert({
      google_account_id: account.id,
      calendar_id: calendarId,
      watch_channel_id: res.data.id ?? channelId,
      watch_resource_id: res.data.resourceId ?? null,
      watch_expiration: res.data.expiration ? new Date(Number(res.data.expiration)).toISOString() : new Date(expiration).toISOString(),
      watch_status: "active",
      watch_ttl_seconds: Math.floor((options?.ttlMs ?? 86_400_000) / 1000),
      watch_checked_at: new Date().toISOString(),
    }, { onConflict: "google_account_id,calendar_id" });

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
      watch_resource_id: null,
      watch_expiration: null,
      watch_status: "inactive",
      watch_checked_at: new Date().toISOString(),
    })
    .eq("google_account_id", account.id)
    .eq("calendar_id", calendarId);

  return { stopped: true };
}

async function fetchAndCacheRange(
  calendar: calendar_v3.Calendar,
  supabase: SupabaseClient,
  accountId: string,
  calendarId: string,
  start: Date,
  end: Date
): Promise<NormalizedGoogleEvent[]> {
  const response = await calendar.events.list({
    calendarId,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    showDeleted: true,
    orderBy: "startTime",
    maxResults: 2500,
  });

  const items = response.data.items ?? [];
  const normalizedEvents = items
    .map((item) => mapGoogleEvent(item, calendarId))
    .filter((event): event is NormalizedGoogleEvent => Boolean(event))
    .filter((event) => event.status !== "cancelled");

  if (normalizedEvents.length) {
    await persistGoogleEvents(supabase, accountId, calendarId, normalizedEvents);
  }

  await removeCancelledEvents(supabase, accountId, calendarId, normalizedEvents);

  const nextSyncToken = response.data.nextSyncToken;
  if (nextSyncToken) {
    await persistSyncState(supabase, accountId, calendarId, {
      syncToken: nextSyncToken,
      windowStart: start,
      windowEnd: end,
    });
  }

  return normalizedEvents;
}

async function fetchWithSyncToken(
  calendar: calendar_v3.Calendar,
  supabase: SupabaseClient,
  accountId: string,
  calendarId: string,
  syncToken: string
) {
  const response = await calendar.events.list({
    calendarId,
    syncToken,
    showDeleted: true,
    maxResults: 2500,
    singleEvents: true,
  });

  const items = response.data.items ?? [];
  const normalizedEvents = items
    .map((item) => mapGoogleEvent(item, calendarId))
    .filter((event): event is NormalizedGoogleEvent => Boolean(event))
    .filter((event) => event.status !== "cancelled");

  if (normalizedEvents.length) {
    await persistGoogleEvents(supabase, accountId, calendarId, normalizedEvents);
  }

  await removeCancelledEvents(supabase, accountId, calendarId, normalizedEvents);

  const nextSyncToken = response.data.nextSyncToken;
  if (nextSyncToken) {
    await persistSyncState(supabase, accountId, calendarId, {
      syncToken: nextSyncToken,
    });
  }
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

export async function getGoogleCalendarClientForUser(
  userId: string,
  options?: { supabase?: SupabaseClient; redirectUri?: string }
) {
  const supabase = options?.supabase ?? await createServerSupabaseClient();
  const account = await fetchAccount(supabase, userId);
  if (!account) {
    throw new GoogleCalendarNotConnectedError();
  }

  const oauth2Client = await ensureAuthorizedClient(account, supabase, options?.redirectUri);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  return { calendar, account };
}

export async function listEventsForRange(
  userId: string,
  start: Date,
  end: Date,
  options?: { calendarId?: string; supabase?: SupabaseClient; redirectUri?: string }
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
      const address = process.env.GOOGLE_CALENDAR_WEBHOOK_URL || `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/integrations/google-calendar/webhook`;
      await startCalendarWatch(userId, calendarId, address, { supabase });
    } catch (err) {
      console.error("[googleCalendar] watch renewal failed", err);
    }
  }

  // Cache-first: if recent and window covers the request, serve cached.
  const recentEnough = syncState?.last_synced_at
    ? Date.now() - new Date(syncState.last_synced_at).getTime() < 5 * 60 * 1000
    : false;
  const covered = syncState ? isRangeCovered(start, end, syncState.window_start, syncState.window_end) : false;

  if (recentEnough && covered) {
    const cached = await fetchCachedEvents(supabase, account.id, calendarId, start, end);
    const canWriteCached = hasCalendarWritePermission(account.scope);
    return { events: cached, canWrite: canWriteCached };
  }

  // Try syncToken diff first
  if (syncState?.sync_token) {
    try {
      await fetchWithSyncToken(calendar, supabase, account.id, calendarId, syncState.sync_token);
    } catch (err: any) {
      const status = err?.code || err?.response?.status;
      if (status === 410) {
        await clearSyncToken(supabase, account.id, calendarId);
        // fall through to full fetch below
      } else {
        console.error("[googleCalendar] syncToken fetch failed", err);
      }
    }
  }

  // Ensure window coverage by full fetch
  await fetchAndCacheRange(calendar, supabase, account.id, calendarId, start, end);

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
