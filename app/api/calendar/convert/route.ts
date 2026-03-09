import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { MAIN_BOARD_ID } from "@/lib/board-defaults";
import {
  syncCardToCalendar,
  buildGoogleDateTimeRange,
  buildGoogleEventDescription,
  resolveAppOrigin,
} from "@/lib/calendarSyncService";
import { generateShortId, slugify } from "@/lib/card-utils";
import { requireAuthenticatedUser } from "@/lib/server/api-security";
import { withErrorHandling } from "@/lib/server/with-error-handling";
import { requireBoardEditorRole } from "@/lib/server/calendar-access";

export const runtime = "nodejs";

type ConvertRequestBody = {
  google_event_id?: string;
  board_id?: string;
};

type GoogleCalendarEventCacheRow = {
  google_event_id: string;
  calendar_id: string | null;
  display_tz: string | null;
  is_all_day: boolean;
  start_utc: string;
  end_utc: string;
  summary: string | null;
  description: string | null;
  etag: string | null;
};

function toLocalParts(iso: string, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => fmt.find((p) => p.type === type)?.value ?? "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

async function findOrCreateList(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  boardId: string
): Promise<string> {
  const { data: lists } = await supabase
    .from("lists")
    .select("id")
    .eq("board_id", boardId)
    .order("position", { ascending: true })
    .limit(1);

  if (lists && lists.length > 0) return lists[0].id as string;

  const { data: newList, error } = await supabase
    .from("lists")
    .insert({ board_id: boardId, title: "To Do", position: 0 })
    .select("id")
    .single();

  if (error || !newList) throw new Error("Failed to create default list");
  return newList.id as string;
}

const postHandler = async (request: NextRequest) => {
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as ConvertRequestBody;
  const googleEventId = body.google_event_id;
  const boardId = body.board_id || MAIN_BOARD_ID;

  if (!googleEventId) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "google_event_id is required" } },
      { status: 400 }
    );
  }

  const canEditBoard = await requireBoardEditorRole(supabase, boardId, user.id);
  if (!canEditBoard) {
    return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }

  const { data: account } = await supabase
    .from("google_calendar_accounts")
    .select("id")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!account?.id) {
    return NextResponse.json({ error: { code: "NOT_CONNECTED" } }, { status: 400 });
  }

  const { data: existingSync } = await supabase
    .from("calendar_sync")
    .select("card_id")
    .eq("google_event_id", googleEventId)
    .eq("google_account_id", account.id)
    .maybeSingle();

  if (existingSync?.card_id) {
    const { data: existingCard } = await supabase
      .from("cards")
      .select("*")
      .eq("id", existingSync.card_id)
      .maybeSingle();
    if (existingCard) {
      return NextResponse.json({ card: existingCard, reused: true }, { status: 200 });
    }
  }

  const { data: gEvent } = await supabase
    .from("google_calendar_events")
    .select("google_event_id, calendar_id, display_tz, is_all_day, start_utc, end_utc, summary, description, etag")
    .eq("google_account_id", account.id)
    .eq("google_event_id", googleEventId)
    .maybeSingle();

  if (!gEvent) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Google event not cached" } },
      { status: 404 }
    );
  }

  const event = gEvent as GoogleCalendarEventCacheRow;
  const tz = event.display_tz || "Asia/Tokyo";
  const startParts = event.is_all_day ? null : toLocalParts(event.start_utc, tz);
  const endParts = event.is_all_day ? null : toLocalParts(event.end_utc, tz);
  const dateParts = toLocalParts(event.start_utc, tz);

  const due_date = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const due_start = event.is_all_day ? null : `${startParts?.hour}:${startParts?.minute}:${startParts?.second}`;
  const due_end = event.is_all_day ? null : `${endParts?.hour}:${endParts?.minute}:${endParts?.second}`;

  const listId = await findOrCreateList(supabase, boardId);
  const positionValue = Math.floor(Date.now() / 1000) % 2147483647;

  const shortId = generateShortId();
  const titleForCard = event.summary || "Google event";
  const slug = slugify(titleForCard);

  const { data: maxIdShortData } = await supabase
    .from("cards")
    .select("id_short")
    .eq("board_id", boardId)
    .order("id_short", { ascending: false })
    .limit(1);

  const idShort = (maxIdShortData?.[0]?.id_short ?? 0) + 1;

  const { data: card, error: insertError } = await supabase
    .from("cards")
    .insert({
      board_id: boardId,
      list_id: listId,
      position: positionValue,
      title: titleForCard,
      tags: [],
      due_date,
      due_start,
      due_end,
      due_bucket: event.is_all_day ? "a" : null,
      due_bucket_position: event.is_all_day ? positionValue : null,
      checked: false,
      assignee_id: null,
      assigned_to: null,
      user_id: user.id,
      short_id: shortId,
      id_short: idShort,
      slug,
    })
    .select()
    .single();

  if (insertError || !card) {
    console.error("[calendar/convert] failed to insert card", insertError);
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: "Failed to create card", details: insertError?.message } },
      { status: 500 }
    );
  }

  await supabase
    .from("calendar_sync")
    .upsert(
      {
        card_id: card.id,
        google_account_id: account.id,
        calendar_id: event.calendar_id ?? "primary",
        google_event_id: event.google_event_id,
        last_google_event_id: event.google_event_id,
        etag: event.etag ?? null,
        status: "active",
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "card_id,google_account_id" }
    );

  if (card.due_start && card.due_end) {
    const { startDateTime, endDateTime } = buildGoogleDateTimeRange({
      due_date: card.due_date,
      due_start: card.due_start,
      due_end: card.due_end,
    });

    if (startDateTime && endDateTime) {
      const origin = request.nextUrl?.origin ?? resolveAppOrigin();
      const description = buildGoogleEventDescription(
        {
          id: card.id,
          short_id: card.short_id,
          slug: card.slug,
          id_short: card.id_short,
          title: card.title,
          description: event.description ?? "",
        },
        origin
      );

      try {
        await syncCardToCalendar(
          supabase,
          user.id,
          card.id,
          {
            summary: card.title,
            description,
            start: { dateTime: startDateTime, timeZone: "Asia/Tokyo" },
            end: { dateTime: endDateTime, timeZone: "Asia/Tokyo" },
          },
          { onlyUpdate: true }
        );
      } catch (error) {
        console.error("[calendar/convert] failed to update Google event metadata", error);
      }
    }
  }

  return NextResponse.json({ card, linked: true }, { status: 201 });
};

export const POST = withErrorHandling(postHandler, "calendar-convert-post");
