import type { DueBucket } from "@/lib/supabase";
import { withJstMidnight } from "@/app/(board)/_utils/timeline-helpers";
import type { TimelineBucketItem, TimelineEvent } from "@/app/(board)/_utils/timeline-helpers";

type BucketDropPositionInput = {
  bucketItems: TimelineBucketItem[];
  bucketKey: string;
  activeCardId: string;
  targetCardId?: string | null;
};

export function resolveSourceDueBucket(args: {
  sourceEvent?: TimelineEvent;
  sourceBucketItem?: TimelineBucketItem;
  sourceBucketKey?: string;
}): DueBucket | null {
  const { sourceEvent, sourceBucketKey } = args;
  if (sourceEvent?.due_bucket) {
    return sourceEvent.due_bucket as DueBucket;
  }
  if (sourceBucketKey) {
    const bucket = sourceBucketKey.split("_")[1];
    if (bucket === "a" || bucket === "b") {
      return bucket;
    }
  }
  return null;
}

export function resolveBucketInsertPosition(args: {
  bucketItems: TimelineBucketItem[];
  targetCardId: string;
  mode: "before" | "after";
}): number {
  const { bucketItems, targetCardId, mode } = args;
  const targetIndex = bucketItems.findIndex((item) => item.card_id === targetCardId);
  if (targetIndex < 0) return Date.now();

  const targetItem = bucketItems[targetIndex];
  if (mode === "before") {
    const prevItem = bucketItems[targetIndex - 1];
    if (prevItem?.bucketPosition != null && targetItem?.bucketPosition != null) {
      return (prevItem.bucketPosition + targetItem.bucketPosition) / 2;
    }
    if (targetItem?.bucketPosition != null) {
      return targetItem.bucketPosition + 1;
    }
    if (prevItem?.bucketPosition != null) {
      return prevItem.bucketPosition + 1;
    }
    return Date.now();
  }

  const nextItem = bucketItems[targetIndex + 1];
  if (targetItem?.bucketPosition != null && nextItem?.bucketPosition != null) {
    return (targetItem.bucketPosition + nextItem.bucketPosition) / 2;
  }
  if (targetItem?.bucketPosition != null) {
    return targetItem.bucketPosition - 1000;
  }
  return Date.now();
}

export function resolveBucketDropPosition({
  bucketItems,
  activeCardId,
  targetCardId,
}: BucketDropPositionInput): number {
  if (!bucketItems.length) return Date.now();
  if (!targetCardId) return bucketItems[0]?.bucketPosition != null ? bucketItems[0].bucketPosition - 1000 : Date.now();
  if (targetCardId === activeCardId) return Date.now();
  return resolveBucketInsertPosition({
    bucketItems,
    targetCardId,
    mode: "after",
  });
}

export function buildTimelineDropPayload(args: {
  dayIso: string;
  nextStart: number;
  duration: number;
  sourceDueBucket: DueBucket | null;
  sourceEvent?: TimelineEvent;
  sourceBucketItem?: TimelineBucketItem;
}) {
  const { dayIso, nextStart, duration, sourceDueBucket, sourceEvent, sourceBucketItem } = args;
  const nextEnd = nextStart + duration;
  return {
    due_bucket: sourceDueBucket,
    due_date: withJstMidnight(dayIso),
    due_start: `${String(Math.floor(nextStart / 60) % 24).padStart(2, "0")}:${String(nextStart % 60).padStart(2, "0")}:00`,
    due_end: `${String(Math.floor(Math.min(nextEnd, 24 * 60 - 1) / 60) % 24).padStart(2, "0")}:${String(Math.min(nextEnd, 24 * 60 - 1) % 60).padStart(2, "0")}:00`,
    due_bucket_position: sourceEvent?.due_bucket_position ?? sourceBucketItem?.bucketPosition ?? null,
  };
}

export function buildBucketDropPayload(args: {
  bucketKey: string;
  dayIso: string | null;
  duration: number;
  bucketPosition: number;
}) {
  const { bucketKey, dayIso, duration, bucketPosition } = args;
  return {
    due_bucket: bucketKey.split("_")[1] as DueBucket,
    due_date: withJstMidnight(dayIso),
    due_start: null,
    due_end: null,
    duration,
    due_bucket_position: bucketPosition,
  };
}
