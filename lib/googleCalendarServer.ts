import "server-only";

import { google, type calendar_v3 } from "googleapis";
import type { GoogleCalendarEvent } from "@/lib/api-types/google-calendar";
import { createServerSupabaseClient } from "@/lib/supabase";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const TOKEN_EXPIRY_BUFFER_MS = 60_000;


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

function coerceDateTime(value?: calendar_v3.Schema$EventDateTime | null): { iso: string; isAllDay: boolean } | null {
  if (!value) return null;
  if (value.dateTime) return { iso: value.dateTime, isAllDay: false };
  if (value.date) {
    // Google returns end.date as exclusive for all-day events; keep as-is with JST midnight.
    return { iso: `${value.date}T00:00:00+09:00`, isAllDay: true };
  }
  return null;
}

function mapGoogleEvent(item: calendar_v3.Schema$Event, calendarId: string): GoogleCalendarEvent | null {
  const start = coerceDateTime(item.start);
  const end = coerceDateTime(item.end);
  if (!start || !end) return null;

  const id = item.id ?? item.iCalUID ?? `${start.iso}-${end.iso}`;
  const title = item.summary ?? "Untitled event";

  return {
    id,
    title,
    start: start.iso,
    end: end.iso,
    isAllDay: start.isAllDay || Boolean(item.start?.date),
    source: "google_calendar",
    calendarId: item.organizer?.email ?? item.creator?.email ?? calendarId,
    htmlLink: item.htmlLink ?? null,
  };
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
  const { calendar, account } = await getGoogleCalendarClientForUser(userId, {
    supabase: options?.supabase,
    redirectUri: options?.redirectUri,
  });

  const calendarId = options?.calendarId ?? "primary";
  const response = await calendar.events.list({
    calendarId,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500,
  });

  const items = response.data.items ?? [];
  const events = items
    .map((item) => mapGoogleEvent(item, calendarId))
    .filter((event): event is GoogleCalendarEvent => Boolean(event));

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
