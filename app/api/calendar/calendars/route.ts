import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  GoogleCalendarNotConnectedError,
  listGoogleCalendarCandidatesForUser,
  saveGoogleCalendarSelectionForUser,
} from "@/lib/googleCalendarServer";
import { withErrorHandling } from "@/lib/server/with-error-handling";

export const runtime = "nodejs";

const getHandler = async (request: NextRequest) => {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Login required" } },
      { status: 401 }
    );
  }

  try {
    const result = await listGoogleCalendarCandidatesForUser(user.id, { supabase });
    return NextResponse.json({
      connected: true,
      calendars: result.calendars,
      selectedCalendarIds: result.selectedCalendarIds,
      canWrite: result.canWrite,
    });
  } catch (error) {
    if (error instanceof GoogleCalendarNotConnectedError) {
      return NextResponse.json({
        connected: false,
        calendars: [],
        selectedCalendarIds: [],
        canWrite: false,
      });
    }
    throw error;
  }
};

const putHandler = async (request: NextRequest) => {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Login required" } },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => null) as { selectedCalendarIds?: unknown } | null;
  const selectedCalendarIds = Array.isArray(body?.selectedCalendarIds)
    ? body.selectedCalendarIds.filter((value): value is string => typeof value === "string")
    : [];

  try {
    const result = await saveGoogleCalendarSelectionForUser(user.id, selectedCalendarIds, { supabase });
    return NextResponse.json({
      connected: true,
      calendars: result.calendars,
      selectedCalendarIds: result.selectedCalendarIds,
    });
  } catch (error) {
    if (error instanceof GoogleCalendarNotConnectedError) {
      return NextResponse.json(
        { error: { code: "GOOGLE_CALENDAR_NOT_CONNECTED", message: "Google Calendar is not connected" } },
        { status: 400 }
      );
    }
    if (error instanceof Error && error.name === "GoogleCalendarSelectionEmptyError") {
      return NextResponse.json(
        { error: { code: "EMPTY_CALENDAR_SELECTION", message: error.message } },
        { status: 400 }
      );
    }
    throw error;
  }
};

export const GET = withErrorHandling(getHandler, "calendar-calendars-get");
export const PUT = withErrorHandling(putHandler, "calendar-calendars-put");
