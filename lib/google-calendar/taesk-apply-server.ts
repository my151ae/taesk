import "server-only";

import type { SupabaseClient } from "@/lib/google-calendar/oauth-server";

type CalendarSyncRow = {
  id: string;
  card_id: string | null;
  google_event_id: string | null;
  last_google_event_id: string | null;
  calendar_id: string;
  google_account_id: string;
  etag: string | null;
  status: string | null;
  last_synced_at: string | null;
};

type NormalizedGoogleEventLike = {
  id: string;
  title: string;
  startUtc: string;
  endUtc: string;
  isAllDay: boolean;
  displayTz: string | null;
  startDate: string | null;
  updatedAtGoogle: string | null;
  etag: string | null;
  taeskCardId?: string | null;
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

export async function applyGoogleEventsToTaeskCards(args: {
  supabase: SupabaseClient;
  accountId: string;
  calendarId: string;
  events: NormalizedGoogleEventLike[];
  defaultDisplayTz?: string;
}): Promise<{ matched: number; updated: number }> {
  const { supabase, accountId, calendarId, events, defaultDisplayTz = "Asia/Tokyo" } = args;

  if (!events.length) return { matched: 0, updated: 0 };

  const taeskCardHints = Array.from(
    new Set(events.map((e) => e.taeskCardId).filter((id): id is string => Boolean(id)))
  );

  const { data: syncRows } = await supabase
    .from("calendar_sync")
    .select("id, card_id, google_event_id, last_google_event_id, calendar_id, google_account_id, etag, status, last_synced_at")
    .eq("google_account_id", accountId)
    .eq("calendar_id", calendarId);

  const cardIds = new Set<string>();
  (syncRows || []).forEach((row) => {
    if (row.card_id) cardIds.add(row.card_id);
  });
  taeskCardHints.forEach((id) => cardIds.add(id));

  if (!cardIds.size) return { matched: 0, updated: 0 };

  const { data: cards, error: cardsError } = await supabase
    .from("cards")
    .select("id, title, due_date, due_start, due_end, updated_at")
    .in("id", Array.from(cardIds));

  if (cardsError) {
    console.error("[googleCalendar] failed to bulk fetch cards", cardsError);
  }

  const cardMap = new Map((cards ?? []).map((card) => [card.id as string, card]));
  const syncMap = new Map<string, CalendarSyncRow>();
  (syncRows || []).forEach((row) => {
    const typedRow = row as CalendarSyncRow;
    if (typedRow.google_event_id) syncMap.set(typedRow.google_event_id, typedRow);
    if (typedRow.last_google_event_id) syncMap.set(typedRow.last_google_event_id, typedRow);
  });

  const updatedCardIds: string[] = [];
  let skippedMissingCard = 0;
  let skippedOlderGoogle = 0;

  for (const event of events) {
    const syncRow = syncMap.get(event.id);
    const cardId =
      syncRow?.card_id ?? (event.taeskCardId && cardMap.has(event.taeskCardId) ? event.taeskCardId : null);
    if (!cardId) {
      skippedMissingCard += 1;
      continue;
    }

    let card = cardMap.get(cardId);
    if (!card) {
      const { data: singleCard } = await supabase
        .from("cards")
        .select("id, title, due_date, due_start, due_end, updated_at")
        .eq("id", cardId)
        .maybeSingle();

      if (singleCard) {
        card = singleCard;
        cardMap.set(cardId, singleCard);
      } else {
        skippedMissingCard += 1;
        continue;
      }
    }

    let googleUpdatedMs = event.updatedAtGoogle ? Date.parse(event.updatedAtGoogle) : NaN;
    if (!Number.isFinite(googleUpdatedMs)) {
      googleUpdatedMs = Date.now();
    }
    const taeskUpdatedMs = card.updated_at ? Date.parse(card.updated_at as string) : NaN;

    if (Number.isFinite(taeskUpdatedMs) && taeskUpdatedMs >= googleUpdatedMs) {
      skippedOlderGoogle += 1;
      continue;
    }

    const tz = event.displayTz || defaultDisplayTz;
    let due_date = card.due_date ?? null;
    let due_start = card.due_start ?? null;
    let due_end = card.due_end ?? null;

    if (event.isAllDay && event.startDate) {
      due_date = event.startDate;
      due_start = null;
      due_end = null;
    } else if (event.startUtc && event.endUtc) {
      const startParts = toLocalParts(event.startUtc, tz);
      const endParts = toLocalParts(event.endUtc, tz);
      due_date = `${startParts.year}-${startParts.month}-${startParts.day}`;
      due_start = `${startParts.hour}:${startParts.minute}:${startParts.second}`;
      due_end = `${endParts.hour}:${endParts.minute}:${endParts.second}`;
    }

    const { error: cardUpdateError } = await supabase
      .from("cards")
      .update({
        title: event.title ?? card.title,
        due_date,
        due_start,
        due_end,
      })
      .eq("id", cardId);

    if (cardUpdateError) {
      console.error("[googleCalendar] failed to update card from Google", {
        cardId,
        error: cardUpdateError,
      });
      continue;
    }

    updatedCardIds.push(cardId);

    if (syncRow) {
      await supabase
        .from("calendar_sync")
        .update({
          etag: event.etag ?? syncRow.etag ?? null,
          last_synced_at: new Date().toISOString(),
          google_event_id: event.id,
          last_google_event_id: event.id,
          status: "active",
        })
        .eq("id", syncRow.id);
    }
  }

  if (skippedMissingCard || skippedOlderGoogle) {
    console.log("[googleCalendar] apply deltas stats", {
      calendarId,
      skippedMissingCard,
      skippedOlderGoogle,
      updated: updatedCardIds.length,
      matchedCards: cardIds.size,
    });
  }

  return { matched: cardIds.size, updated: updatedCardIds.length };
}
