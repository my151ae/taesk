import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  syncCardToCalendar,
  deleteCardFromCalendar,
  unlinkCardFromCalendar,
  getCalendarSyncRecord,
  GooglePermissionError,
  GoogleRateLimitError,
  buildGoogleEventDescription,
  buildGoogleDateTimeRange,
  resolveAppOrigin,
} from "@/lib/calendarSyncService";
import { GoogleCalendarNotConnectedError, syncGoogleCalendarToTaesk } from "@/lib/googleCalendarServer";
import { requireAuthenticatedUser } from "@/lib/server/api-security";
import { withErrorHandling } from "@/lib/server/with-error-handling";
import { getAccessibleCardByIdOrShortId } from "@/lib/server/calendar-access";

export const runtime = "nodejs";

type RouteParams = { cardId: string };

type SyncStatusResponse = {
  status: "active" | "unlinked" | "deleted";
  google_event_id: string | null;
  last_google_event_id: string | null;
  etag: string | null;
  last_synced_at: string | null;
};

const syncCardHandler = async (
  request: NextRequest,
  context?: { params: Promise<RouteParams> }
) => {
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }

  const { cardId } = await context!.params;

  try {
    const card = await getAccessibleCardByIdOrShortId(supabase, cardId, user.id);
    if (!card) {
      return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    }

    if (!card.due_start || !card.due_end) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", message: "Card must have start and end dates" } },
        { status: 400 }
      );
    }

    const { startDateTime, endDateTime } = buildGoogleDateTimeRange({
      due_date: card.due_date,
      due_start: card.due_start,
      due_end: card.due_end,
    });

    if (!startDateTime || !endDateTime) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", message: "Invalid date/time for Google Calendar sync" } },
        { status: 400 }
      );
    }

    const { data: existingSync } = await supabase
      .from("calendar_sync")
      .select("calendar_id")
      .eq("card_id", card.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let pullStats: { matched: number; updated: number } | null = null;
    try {
      pullStats = await syncGoogleCalendarToTaesk(user.id, existingSync?.calendar_id ?? "primary", {
        supabase,
        reason: "manual_sync",
      });
    } catch (pullError) {
      console.error("[calendar-sync][manual] pull failed, proceeding to push", pullError);
    }

    const origin = request.nextUrl?.origin ?? resolveAppOrigin();
    const description = buildGoogleEventDescription(
      {
        id: card.id,
        short_id: card.short_id,
        slug: card.slug,
        id_short: card.id_short,
        title: card.title,
        description: card.excerpt ?? "",
      },
      origin
    );

    const googleEventIdOverride = request.nextUrl.searchParams.get("google_event_id");

    const result = await syncCardToCalendar(
      supabase,
      user.id,
      card.id,
      {
        summary: card.title,
        description,
        start: { dateTime: startDateTime, timeZone: "Asia/Tokyo" },
        end: { dateTime: endDateTime, timeZone: "Asia/Tokyo" },
      },
      googleEventIdOverride ? { googleEventId: googleEventIdOverride } : {}
    );

    if (result?.eventId) {
      await supabase
        .from("calendar_sync")
        .update({ last_google_event_id: result.eventId })
        .eq("card_id", card.id);
    }

    return NextResponse.json({ success: true, pullStats, result });
  } catch (error) {
    if (error instanceof GoogleCalendarNotConnectedError) {
      return NextResponse.json(
        { error: { code: error.code, message: "Google Calendar is not connected" } },
        { status: 401 }
      );
    }
    if (error instanceof GooglePermissionError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, retryable: false } },
        { status: 403 }
      );
    }
    if (error instanceof GoogleRateLimitError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, retryable: true } },
        { status: 429 }
      );
    }
    throw error;
  }
};

const getSyncStatusHandler = async (
  _request: NextRequest,
  context?: { params: Promise<RouteParams> }
) => {
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }

  const { cardId } = await context!.params;

  const card = await getAccessibleCardByIdOrShortId(supabase, cardId, user.id);
  if (!card) {
    return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  const { data: account } = await supabase
    .from("google_calendar_accounts")
    .select("id")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!account?.id) {
    return NextResponse.json({ status: "unlinked" }, { status: 200 });
  }

  const { data: syncRow, error } = await supabase
    .from("calendar_sync")
    .select("status, google_event_id, last_google_event_id, etag, last_synced_at")
    .eq("card_id", card.id)
    .eq("google_account_id", account.id)
    .maybeSingle();

  if (error) {
    console.error("[calendar-sync][GET] failed", error);
    return NextResponse.json({ error: { code: "DB_ERROR" } }, { status: 500 });
  }

  if (!syncRow) {
    return NextResponse.json({ status: "unlinked" }, { status: 200 });
  }

  return NextResponse.json(syncRow as SyncStatusResponse, { status: 200 });
};

const deleteSyncHandler = async (
  request: NextRequest,
  context?: { params: Promise<RouteParams> }
) => {
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }

  const { cardId } = await context!.params;
  const mode = request.nextUrl.searchParams.get("mode") ?? "delete";

  const card = await getAccessibleCardByIdOrShortId(supabase, cardId, user.id);
  if (!card) {
    return NextResponse.json({ success: true, message: "Card not found, assumed handled" });
  }

  try {
    if (mode === "delete") {
      await deleteCardFromCalendar(supabase, user.id, card.id);

      const existingSync = await getCalendarSyncRecord(supabase, card.id).catch(() => null);
      const lastGoogleEventId = existingSync?.last_google_event_id ?? existingSync?.google_event_id ?? null;

      await supabase
        .from("calendar_sync")
        .update({
          status: "deleted",
          google_event_id: null,
          etag: null,
          ...(lastGoogleEventId ? { last_google_event_id: lastGoogleEventId } : {}),
        })
        .eq("card_id", card.id);
    } else {
      const existingSync = await getCalendarSyncRecord(supabase, card.id).catch(() => null);
      const lastGoogleEventId = existingSync?.last_google_event_id ?? existingSync?.google_event_id ?? null;

      await unlinkCardFromCalendar(supabase, user.id, card.id);

      await supabase
        .from("calendar_sync")
        .update({
          status: "unlinked",
          google_event_id: null,
          etag: null,
          ...(lastGoogleEventId ? { last_google_event_id: lastGoogleEventId } : {}),
        })
        .eq("card_id", card.id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof GoogleCalendarNotConnectedError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 401 });
    }
    if (error instanceof GooglePermissionError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 403 });
    }
    if (error instanceof GoogleRateLimitError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 429 });
    }
    throw error;
  }
};

export const POST = withErrorHandling<RouteParams>(syncCardHandler, "calendar-sync-post");
export const PATCH = withErrorHandling<RouteParams>(syncCardHandler, "calendar-sync-patch");
export const GET = withErrorHandling<RouteParams>(getSyncStatusHandler, "calendar-sync-get");
export const DELETE = withErrorHandling<RouteParams>(deleteSyncHandler, "calendar-sync-delete");
