import { bucketKeyToDueBucket } from "@/lib/bucket-normalization";
import {
  type TimelineBucketItem,
  type TimelineEvent,
  formatDuration,
  timeLabel,
} from "@/app/(board)/_utils/timeline-helpers";

export type OverlayBucketEntry = {
  key: string;
  item: TimelineBucketItem;
};

export type OverlayCardData = {
  title: string;
  badge: string;
  timeText: string | null;
  note: string | null;
};

export function findOverlayBucketEntry(
  buckets: Record<string, TimelineBucketItem[]>,
  cardId: string | null
): OverlayBucketEntry | null {
  if (!cardId) return null;
  const entries = Object.entries(buckets);
  for (const [key, items] of entries) {
    const found = items.find((item) => item.card_id === cardId);
    if (found) return { key, item: found };
  }
  return null;
}

export function buildOverlayCardData(args: {
  timelineEvent: TimelineEvent | null | undefined;
  bucketEntry: OverlayBucketEntry | null;
  defaultTimelineDuration?: number;
}): OverlayCardData | null {
  const { timelineEvent, bucketEntry, defaultTimelineDuration = 60 } = args;
  if (timelineEvent) {
    return {
      title: timelineEvent.title || "",
      badge: timelineEvent.due_bucket ?? "a",
      timeText: `${timeLabel(timelineEvent.due_start, timelineEvent.due_end)} :${formatDuration(
        timelineEvent.durationMinutes ?? defaultTimelineDuration
      )}`,
      note: timelineEvent.excerpt ?? null,
    };
  }

  const bucketCard = bucketEntry?.item ?? null;
  const bucketKey = bucketEntry?.key ?? null;
  if (!bucketCard) return null;

  return {
    title: bucketCard.title || "",
    badge: bucketKey ? bucketKeyToDueBucket(bucketKey) : "a",
    timeText:
      bucketCard.duration != null
        ? `:${formatDuration(bucketCard.duration)} ${
            bucketCard.due_start ? timeLabel(bucketCard.due_start, bucketCard.due_end) : ""
          }`
        : bucketCard.due_start
        ? timeLabel(bucketCard.due_start, bucketCard.due_end)
        : null,
    note: bucketCard.excerpt ?? null,
  };
}
