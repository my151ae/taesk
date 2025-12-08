import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  GoogleCalendarNotConnectedError,
  listEventsForRange,
  listCachedEventsForRange,
  disconnectGoogleCalendarAccount,
  getGoogleCalendarClientForUser,
  hasCalendarWritePermission,
} from "@/lib/googleCalendarServer";

export const runtime = "nodejs";

const MAX_RANGE_DAYS = 31;

const parseDateParam = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export async function GET(request: NextRequest) {
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

  // MODE 1: Permission Check Only (No dates provided)
  if (!startParam && !endParam) {
    try {
      const { account } = await getGoogleCalendarClientForUser(user.id, { supabase });
      const canWrite = hasCalendarWritePermission(account.scope);
      return NextResponse.json({ connected: true, canWrite, events: [] }, { status: 200 });
    } catch (error: any) {
      if (error instanceof GoogleCalendarNotConnectedError) {
        return NextResponse.json({ connected: false, events: [] }, { status: 200 });
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

  try {
    const { events, canWrite } = await listEventsForRange(user.id, start, end, { supabase });
    return NextResponse.json({ connected: true, canWrite, events }, { status: 200 });
  } catch (error: any) {
    if (error instanceof GoogleCalendarNotConnectedError) {
      return NextResponse.json({ connected: false, events: [] }, { status: 200 });
    }

    const status = error?.response?.status;
    const errorCode = error?.code;

    if (status === 401 || status === 403 || errorCode === "invalid_grant") {
      await disconnectGoogleCalendarAccount(user.id, supabase);
      return NextResponse.json(
        { connected: false, events: [], error: "DISCONNECTED" },
        { status: 200 }
      );
    }

    if (status === 429) {
      return NextResponse.json(
        { connected: true, events: [], error: "RATE_LIMITED" },
        { status: 429 }
      );
    }

    if (status === 503) {
      return NextResponse.json(
        { connected: true, events: [], error: "SERVICE_UNAVAILABLE" },
        { status: 503 }
      );
    }

    // Fallback: serve cached events if available
    try {
      const { events, canWrite } = await listCachedEventsForRange(user.id, start, end, { supabase });
      return NextResponse.json({ connected: true, canWrite, events, error: "STALE_CACHE" }, { status: 200 });
    } catch (cacheError) {
      console.error("[googleCalendar/events] cache fallback failed", cacheError);
    }

    console.error("[googleCalendar/events] failed to fetch events", error);
    return NextResponse.json(
      { error: { code: "GOOGLE_CALENDAR_FETCH_FAILED", message: "Failed to fetch Google Calendar events" } },
      { status: 500 }
    );
  }
}
