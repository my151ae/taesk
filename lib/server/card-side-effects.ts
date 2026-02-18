import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildGoogleDateTimeRange,
  buildGoogleEventDescription,
  deleteCardFromCalendar,
  resolveAppOrigin,
  syncCardToCalendar,
} from "@/lib/calendarSyncService";

type ActivityAction = "created" | "updated" | "moved" | "deleted";

type ActivityLogInput = {
  boardId: string;
  userId: string;
  cardId: string;
  cardTitle: string | null;
  action: ActivityAction;
};

type SyncableCard = {
  id: string;
  title: string;
  excerpt?: string | null;
  short_id?: string | null;
  slug?: string | null;
  id_short?: number | null;
  due_date?: string | null;
  due_start?: string | null;
  due_end?: string | null;
};

export function logCardActivity(
  supabase: SupabaseClient,
  input: ActivityLogInput
) {
  void supabase
    .from("activity_logs")
    .insert({
      board_id: input.boardId,
      user_id: input.userId,
      action: input.action,
      entity_type: "card",
      entity_id: input.cardId,
      entity_title: input.cardTitle,
    })
    .then(({ error }) => {
      if (error) {
        console.error("[cards] activity log failed", {
          cardId: input.cardId,
          action: input.action,
          error,
        });
      }
    });
}

export async function syncPatchedCardToCalendar(args: {
  supabase: SupabaseClient;
  userId: string;
  card: SyncableCard;
  requestOrigin?: string;
}) {
  const { supabase, userId, card, requestOrigin } = args;

  if (!card.due_start || !card.due_end) return;

  const { startDateTime, endDateTime } = buildGoogleDateTimeRange({
    due_date: card.due_date ?? null,
    due_start: card.due_start ?? null,
    due_end: card.due_end ?? null,
  });

  if (!startDateTime || !endDateTime) return;

  const origin = requestOrigin ?? resolveAppOrigin();
  const description = buildGoogleEventDescription(
    {
      id: card.id,
      short_id: card.short_id ?? null,
      slug: card.slug ?? null,
      id_short: card.id_short ?? null,
      title: card.title,
      description: card.excerpt ?? "",
    },
    origin
  );

  await syncCardToCalendar(
    supabase,
    userId,
    card.id,
    {
      summary: card.title,
      description,
      start: { dateTime: startDateTime, timeZone: "Asia/Tokyo" },
      end: { dateTime: endDateTime, timeZone: "Asia/Tokyo" },
    },
    { onlyUpdate: true }
  );
}

export async function deleteCardFromCalendarBestEffort(
  supabase: SupabaseClient,
  userId: string,
  cardId: string
) {
  try {
    await deleteCardFromCalendar(supabase, userId, cardId);
  } catch (error) {
    console.error("[cards] google sync delete failed", { cardId, error });
  }
}
