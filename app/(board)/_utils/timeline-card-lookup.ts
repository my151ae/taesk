import type { TimelineBucketItem, TimelineEvent, TimelineOverdueItem, TimelineResponse } from '@/app/(board)/_utils/timeline-helpers';

type TimelineCardLookup = {
  event: TimelineEvent | null;
  bucketItem: TimelineBucketItem | null;
  overdueItem: TimelineOverdueItem | null;
  bucketKey: string | null;
};

export function findEventByCardId(data: TimelineResponse | null, cardId: string): TimelineEvent | null {
  if (!data) return null;
  return data.events.find((event) => event.card_id === cardId) ?? null;
}

export function findBucketItemByCardId(data: TimelineResponse | null, cardId: string): { item: TimelineBucketItem; key: string } | null {
  if (!data) return null;
  for (const [key, items] of Object.entries(data.abBuckets)) {
    const found = items.find((item) => item.card_id === cardId);
    if (found) return { item: found, key };
  }
  return null;
}

export function findTimelineCardById(data: TimelineResponse | null, cardId: string): TimelineCardLookup {
  const event = findEventByCardId(data, cardId);
  if (event) {
    return {
      event,
      bucketItem: null,
      overdueItem: null,
      bucketKey: null,
    };
  }

  const bucketMatch = findBucketItemByCardId(data, cardId);
  if (bucketMatch) {
    return {
      event: null,
      bucketItem: bucketMatch.item,
      overdueItem: null,
      bucketKey: bucketMatch.key,
    };
  }

  const overdueItem = data?.overdue.find((item) => item.card_id === cardId) ?? null;
  return {
    event: null,
    bucketItem: null,
    overdueItem,
    bucketKey: null,
  };
}
