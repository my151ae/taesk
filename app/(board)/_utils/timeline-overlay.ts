import { bucketKeyToDueBucket } from "@/lib/bucket-normalization";
import {
  type TimelineBucketItem,
  type TimelineEvent,
  type TimelineOverdueItem,
  formatDuration,
  timeLabel,
  toLocalDay,
} from "@/app/(board)/_utils/timeline-helpers";

export type OverlayBucketEntry = {
  key: string;
  item: TimelineBucketItem;
};

export type OverlayOverdueEntry = {
  item: TimelineOverdueItem;
};

export type OverlayCardData = {
  title: string;
  badge: string;
  timeText: string | null;
  note: string | null;
};

function formatOverdueDateLabel(value: string | null) {
  const localDay = toLocalDay(value);
  if (!localDay) return "No date";
  const [, month, day] = localDay.split("-");
  return `${Number(month)}/${Number(day)}`;
}

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

export function findOverlayOverdueEntry(
  overdue: TimelineOverdueItem[],
  cardId: string | null
): OverlayOverdueEntry | null {
  if (!cardId) return null;
  const item = overdue.find((entry) => entry.card_id === cardId);
  return item ? { item } : null;
}

export function buildOverlayCardData(args: {
  timelineEvent: TimelineEvent | null | undefined;
  bucketEntry: OverlayBucketEntry | null;
  overdueEntry?: OverlayOverdueEntry | null;
  defaultTimelineDuration?: number;
}): OverlayCardData | null {
  const { timelineEvent, bucketEntry, overdueEntry = null, defaultTimelineDuration = 60 } = args;
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
  if (bucketCard) {
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

  const overdueItem = overdueEntry?.item ?? null;
  if (!overdueItem) return null;

  const overdueLabel = formatOverdueDateLabel(overdueItem.due_date ?? null);
  const overdueParts: string[] = [];
  overdueParts.push(overdueLabel);
  if (overdueItem.due_start) {
    overdueParts.push(timeLabel(overdueItem.due_start, overdueItem.due_end));
  }
  if (overdueItem.duration != null) {
    overdueParts.push(`[${formatDuration(overdueItem.duration)}]`);
  }
  return {
    title: overdueItem.title || "",
    badge: overdueItem.due_bucket ?? "o",
    timeText: overdueParts.join(" "),
    note: overdueItem.excerpt ?? null,
  };
}
