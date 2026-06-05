import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  GoogleCalendarNotConnectedError,
  listEventsForRange,
  listCachedEventsForRangeDbOnly,
  disconnectGoogleCalendarAccount,
  hasCalendarWritePermission,
  getSelectedGoogleCalendarsForUser,
} from "@/lib/googleCalendarServer";
import type { GoogleCalendarEvent, GoogleCalendarPartialError } from "@/lib/api-types/google-calendar";
import { withErrorHandling } from "@/lib/server/with-error-handling";

export const runtime = "nodejs";

const MAX_RANGE_DAYS = 130;

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

  const getSelectedCalendars = async () => getSelectedGoogleCalendarsForUser(user.id, { supabase });

  const toPartialError = (calendarId: string, error: unknown): GoogleCalendarPartialError => {
    const parsed = toGoogleApiError(error);
    const message = error instanceof Error ? error.message : "Failed to fetch Google Calendar events";
    return {
      calendarId,
      message,
      status: parsed.response?.status,
    };
  };

  const loadCacheOnlyForSelected = async (
    selectedCalendarIds: string[],
    metadataByCalendarId: Map<string, { summary: string | null; backgroundColor: string | null; foregroundColor: string | null }>,
    rangeStart: Date,
    rangeEnd: Date,
  ) => {
    const partialErrors: GoogleCalendarPartialError[] = [];
    const chunks = [];
    for (const calendarId of selectedCalendarIds) {
      try {
        const cached = await listCachedEventsForRangeDbOnly(user.id, rangeStart, rangeEnd, {
          supabase,
          calendarId,
          calendarMetadata: metadataByCalendarId.get(calendarId),
        });
        chunks.push({ calendarId, cached });
      } catch (error) {
        partialErrors.push(toPartialError(calendarId, error));
      }
    }
    return { chunks, partialErrors };
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

      const connected = Boolean(account?.id);
      return NextResponse.json({
        connected,
        canWrite: account?.scope ? hasCalendarWritePermission(account.scope) : false,
        events: [],
        source: connected ? "cache" : "none",
        stale: connected,
        lastSyncedAt: null,
        backgroundRefreshRecommended: connected,
      }, { status: 200 });
    }

    try {
      const selected = await getSelectedCalendars();
      return NextResponse.json({
        connected: true,
        canWrite: selected.canWrite,
        events: [],
        calendars: selected.calendars,
        selectedCalendarIds: selected.selectedCalendarIds,
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
  let selectedCalendars: Awaited<ReturnType<typeof getSelectedCalendars>>;
  try {
    selectedCalendars = await getSelectedCalendars();
  } catch (error) {
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
    throw error;
  }

  if (mode === "cache-only") {
    const { chunks, partialErrors } = await loadCacheOnlyForSelected(
      selectedCalendars.selectedCalendarIds,
      selectedCalendars.metadataByCalendarId,
      start,
      end
    );
    const events = chunks.flatMap((chunk) => chunk.cached.events);
    const lastSyncedAtValues = chunks
      .map((chunk) => chunk.cached.lastSyncedAt)
      .filter((value): value is string => Boolean(value));
    const stale = chunks.some((chunk) => chunk.cached.stale) || chunks.length === 0;
    const source = chunks.length ? "cache" : "none";
    return NextResponse.json({
      connected: true,
      canWrite: selectedCalendars.canWrite,
      events: applyLinkedFilter(events, linkedEventIds),
      calendars: selectedCalendars.calendars,
      selectedCalendarIds: selectedCalendars.selectedCalendarIds,
      partialErrors,
      source,
      stale,
      lastSyncedAt: lastSyncedAtValues.length ? lastSyncedAtValues.sort()[0] : null,
      backgroundRefreshRecommended: stale || source === "none",
    }, { status: 200 });
  }

  try {
    const partialErrors: GoogleCalendarPartialError[] = [];
    const eventChunks = [];
    for (const calendarId of selectedCalendars.selectedCalendarIds) {
      try {
        const result = await listEventsForRange(user.id, start, end, {
          supabase,
          origin: request.nextUrl.origin,
          calendarId,
          calendarMetadata: selectedCalendars.metadataByCalendarId.get(calendarId),
          syncCardsOnFetch: mode === "refresh" ? syncCardsOnFetch : true,
        });
        eventChunks.push(result.events);
      } catch (error) {
        partialErrors.push(toPartialError(calendarId, error));
      }
    }

    if (!eventChunks.length && partialErrors.length) {
      throw partialErrors[0];
    }

    const events = eventChunks.flat();
    return NextResponse.json({
      connected: true,
      canWrite: selectedCalendars.canWrite,
      events: applyLinkedFilter(events, linkedEventIds),
      calendars: selectedCalendars.calendars,
      selectedCalendarIds: selectedCalendars.selectedCalendarIds,
      partialErrors,
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
      const { chunks, partialErrors } = await loadCacheOnlyForSelected(
        selectedCalendars.selectedCalendarIds,
        selectedCalendars.metadataByCalendarId,
        start,
        end
      );
      const events = chunks.flatMap((chunk) => chunk.cached.events);
      const lastSyncedAtValues = chunks
        .map((chunk) => chunk.cached.lastSyncedAt)
        .filter((value): value is string => Boolean(value));
      return NextResponse.json({
        connected: true,
        canWrite: selectedCalendars.canWrite,
        events: applyLinkedFilter(events, linkedEventIds),
        calendars: selectedCalendars.calendars,
        selectedCalendarIds: selectedCalendars.selectedCalendarIds,
        partialErrors,
        source: chunks.length ? "cache" : "none",
        stale: true,
        lastSyncedAt: lastSyncedAtValues.length ? lastSyncedAtValues.sort()[0] : null,
        backgroundRefreshRecommended: true,
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
