import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  GoogleCalendarNotConnectedError,
  listEventsForRange,
  listCachedEventsForRangeDbOnly,
  disconnectGoogleCalendarAccount,
  getGoogleCalendarClientForUser,
  hasCalendarWritePermission,
} from "@/lib/googleCalendarServer";
import type { GoogleCalendarEvent } from "@/lib/api-types/google-calendar";
import { withErrorHandling } from "@/lib/server/with-error-handling";

export const runtime = "nodejs";

const MAX_RANGE_DAYS = 130;
const STALE_CACHE_MS = 5 * 60 * 1000;

type GoogleApiError = {
  code?: string;
  response?: { status?: number };
};

const toGoogleApiError = (error: unknown): GoogleApiError => {
  if (!error || typeof error !== "object") return {};
  return error as GoogleApiError;
};

const parseDateParam = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isStaleLastSyncedAt = (lastSyncedAt: string | null) => {
  if (!lastSyncedAt) return true;
  const syncedMs = Date.parse(lastSyncedAt);
  return !Number.isFinite(syncedMs) || Date.now() - syncedMs > STALE_CACHE_MS;
};

const getHandler = async (request: NextRequest) => {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Login required" } },
      { status: 401 }
    );
  }

  const startParam = request.nextUrl.searchParams.get("start");
  const endParam = request.nextUrl.searchParams.get("end");
  const modeParam = request.nextUrl.searchParams.get("mode");
  const mode = modeParam === "cache-only" || modeParam === "refresh" ? modeParam : "default";
  const syncCardsOnFetch = request.nextUrl.searchParams.get("syncCardsOnFetch") !== "false";

  const applyLinkedFilter = (events: GoogleCalendarEvent[], linkedIds: Set<string>) => {
    if (!linkedIds.size) return events;
    return events.filter((event) => !linkedIds.has(event.id));
  };

  const loadLinkedEventIds = async () => {
    const linkedEventIds = new Set<string>();
    const { data: account } = await supabase
      .from("google_calendar_accounts")
      .select("id")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (account?.id) {
      const { data: syncRows } = await supabase
        .from("calendar_sync")
        .select("google_event_id, last_google_event_id, status")
        .eq("google_account_id", account.id);

      (syncRows ?? []).forEach((row) => {
        if (row.status === "active") {
          if (row.google_event_id) linkedEventIds.add(row.google_event_id);
          if (row.last_google_event_id) linkedEventIds.add(row.last_google_event_id);
        }
      });
    }

    return linkedEventIds;
  };

  // MODE 1: Permission Check Only (No dates provided)
  if (!startParam && !endParam) {
    if (mode === "cache-only") {
      const { data: account } = await supabase
        .from("google_calendar_accounts")
        .select("id, scope")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: syncState } = account?.id
        ? await supabase
            .from("google_calendar_sync_states")
            .select("last_synced_at")
            .eq("google_account_id", account.id)
            .eq("calendar_id", "primary")
            .maybeSingle()
        : { data: null };

      const lastSyncedAt = syncState?.last_synced_at ?? null;
      const stale = isStaleLastSyncedAt(lastSyncedAt);
      const connected = Boolean(account?.id);
      return NextResponse.json({
        connected,
        canWrite: account?.scope ? hasCalendarWritePermission(account.scope) : false,
        events: [],
        source: connected ? "cache" : "none",
        stale,
        lastSyncedAt,
        backgroundRefreshRecommended: connected && (stale || false),
      }, { status: 200 });
    }

    try {
      const { account } = await getGoogleCalendarClientForUser(user.id, { supabase });
      const canWrite = hasCalendarWritePermission(account.scope);
      return NextResponse.json({
        connected: true,
        canWrite,
        events: [],
        source: "google",
        stale: false,
        lastSyncedAt: null,
        backgroundRefreshRecommended: false,
      }, { status: 200 });
    } catch (error: unknown) {
      if (error instanceof GoogleCalendarNotConnectedError) {
        return NextResponse.json({
          connected: false,
          events: [],
          source: "none",
          stale: true,
          lastSyncedAt: null,
          backgroundRefreshRecommended: false,
        }, { status: 200 });
      }
      // For other errors during simple check, return internal error or specific status
      console.error("[googleCalendar/check] failed to check connection", error);
      return NextResponse.json(
        { error: { code: "GOOGLE_CALENDAR_CHECK_FAILED", message: "Failed to check Google Calendar connection" } },
        { status: 500 }
      );
    }
  }

  // MODE 2: Event Fetching
  const start = parseDateParam(startParam);
  const end = parseDateParam(endParam);

  if (!start || !end) {
    return NextResponse.json(
      { error: { code: "INVALID_RANGE", message: "start and end must be valid ISO dates" } },
      { status: 400 }
    );
  }

  if (start.getTime() >= end.getTime()) {
    return NextResponse.json(
      { error: { code: "INVALID_RANGE", message: "start must be before end" } },
      { status: 400 }
    );
  }

  const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: { code: "RANGE_TOO_LARGE", message: `Range must be within ${MAX_RANGE_DAYS} days` } },
      { status: 400 }
    );
  }

  const linkedEventIds = await loadLinkedEventIds();

  if (mode === "cache-only") {
    const cached = await listCachedEventsForRangeDbOnly(user.id, start, end, { supabase });
    const source = cached.connected ? "cache" : "none";
    return NextResponse.json({
      connected: cached.connected,
      canWrite: cached.canWrite,
      events: applyLinkedFilter(cached.events, linkedEventIds),
      source,
      stale: cached.stale,
      lastSyncedAt: cached.lastSyncedAt,
      backgroundRefreshRecommended: cached.connected && (cached.stale || source === "none"),
    }, { status: 200 });
  }

  try {
    const { events, canWrite } = await listEventsForRange(user.id, start, end, {
      supabase,
      origin: request.nextUrl.origin,
      syncCardsOnFetch: mode === "refresh" ? syncCardsOnFetch : true,
    });
    return NextResponse.json({
      connected: true,
      canWrite,
      events: applyLinkedFilter(events, linkedEventIds),
      source: "google",
      stale: false,
      lastSyncedAt: new Date().toISOString(),
      backgroundRefreshRecommended: false,
    }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof GoogleCalendarNotConnectedError) {
      return NextResponse.json({
        connected: false,
        events: [],
        source: "none",
        stale: true,
        lastSyncedAt: null,
        backgroundRefreshRecommended: false,
      }, { status: 200 });
    }

    const parsed = toGoogleApiError(error);
    const status = parsed.response?.status;
    const errorCode = parsed.code;

    if (status === 401 || status === 403 || errorCode === "invalid_grant") {
      await disconnectGoogleCalendarAccount(user.id, supabase);
      return NextResponse.json(
        {
          connected: false,
          events: [],
          source: "none",
          stale: true,
          lastSyncedAt: null,
          backgroundRefreshRecommended: false,
          error: "DISCONNECTED",
        },
        { status: 200 }
      );
    }

    if (status === 429) {
      return NextResponse.json(
        {
          connected: true,
          events: [],
          source: "none",
          stale: true,
          lastSyncedAt: null,
          backgroundRefreshRecommended: true,
          error: "RATE_LIMITED",
        },
        { status: 429 }
      );
    }

    if (status === 503) {
      return NextResponse.json(
        {
          connected: true,
          events: [],
          source: "none",
          stale: true,
          lastSyncedAt: null,
          backgroundRefreshRecommended: true,
          error: "SERVICE_UNAVAILABLE",
        },
        { status: 503 }
      );
    }

    // Fallback: serve cached events if available
    try {
      const cached = await listCachedEventsForRangeDbOnly(user.id, start, end, { supabase });
      return NextResponse.json({
        connected: cached.connected,
        canWrite: cached.canWrite,
        events: applyLinkedFilter(cached.events, linkedEventIds),
        source: cached.connected ? "cache" : "none",
        stale: true,
        lastSyncedAt: cached.lastSyncedAt,
        backgroundRefreshRecommended: cached.connected,
        error: "STALE_CACHE",
      }, { status: 200 });
    } catch (cacheError) {
      console.error("[googleCalendar/events] cache fallback failed", cacheError);
    }

    console.error("[googleCalendar/events] failed to fetch events", error);
    return NextResponse.json(
      { error: { code: "GOOGLE_CALENDAR_FETCH_FAILED", message: "Failed to fetch Google Calendar events" } },
      { status: 500 }
    );
  }
};

export const GET = withErrorHandling(getHandler, "calendar-events-get");
