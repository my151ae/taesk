import type { ReactNode } from "react";

import { countCheckedLines, countNonEmptyLines, type Checklist } from "@/lib/checklist";
import { formatDuration, timeLabel, toLocalDay } from "@/app/(board)/_utils/timeline-helpers";

export type TimelineCardStatusItem = {
  key: string;
  kind: "tag" | "time" | "bucket" | "progress" | "reminder";
  label?: string;
  icon?: ReactNode;
};

type CardMetaSource = {
  due_date?: string | null;
  due_start?: string | null;
  due_end?: string | null;
  duration?: number | null;
  durationMinutes?: number | null;
  due_bucket?: string | null;
  tags?: string[] | null;
  checklist?: Checklist | null;
  start_reminder_enabled?: boolean;
  end_reminder_enabled?: boolean;
};

type BuildCardTimeTextOptions = {
  includeDate?: boolean;
  includeTime?: boolean;
  includeDuration?: boolean;
  showAnytime?: boolean;
};

type BuildTimelineCardStatusItemsOptions = BuildCardTimeTextOptions & {
  includeTags?: boolean;
  includeBucket?: boolean;
  includeProgress?: boolean;
  includeReminder?: boolean;
  bucketLabel?: string | null;
  maxTags?: number;
};

export function formatTimelineCardDateLabel(value: string | null | undefined) {
  const localDay = toLocalDay(value);
  if (!localDay) return "No date";
  const [, month, day] = localDay.split("-");
  return `${Number(month)}/${Number(day)}`;
}

export function resolveTimelineCardDuration(source: CardMetaSource) {
  return source.duration ?? source.durationMinutes ?? null;
}

export function buildTimelineCardTimeText(
  source: CardMetaSource,
  options: BuildCardTimeTextOptions = {}
) {
  const {
    includeDate = false,
    includeTime = true,
    includeDuration = true,
    showAnytime = false,
  } = options;
  const parts: string[] = [];

  if (includeDate) {
    parts.push(formatTimelineCardDateLabel(source.due_date ?? null));
  }

  if (includeTime) {
    if (source.due_start || source.due_end) {
      parts.push(timeLabel(source.due_start ?? null, source.due_end ?? null));
    } else if (showAnytime) {
      parts.push("Anytime");
    }
  }

  if (includeDuration) {
    const duration = resolveTimelineCardDuration(source);
    if (duration != null) {
      parts.push(`[${formatDuration(duration)}]`);
    }
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

export function buildTimelineCardStatusItems(
  source: CardMetaSource,
  options: BuildTimelineCardStatusItemsOptions = {}
): TimelineCardStatusItem[] {
  const {
    includeDate = false,
    includeTime = true,
    includeDuration = true,
    showAnytime = false,
    includeTags = true,
    includeBucket = true,
    includeProgress = true,
    includeReminder = true,
    bucketLabel,
    maxTags = 2,
  } = options;

  const items: TimelineCardStatusItem[] = [];

  if (includeTags) {
    const tags = (source.tags ?? []).filter(Boolean).slice(0, Math.max(0, maxTags));
    for (const tag of tags) {
      items.push({
        key: `tag:${tag}`,
        kind: "tag",
        label: `#${tag}`,
      });
    }
  }

  const timeLabelText = buildTimelineCardTimeText(source, {
    includeDate,
    includeTime,
    includeDuration,
    showAnytime,
  });
  if (timeLabelText) {
    items.push({
      key: "time",
      kind: "time",
      label: timeLabelText,
    });
  }

  if (includeBucket) {
    const resolvedBucket = bucketLabel ?? source.due_bucket?.toUpperCase() ?? null;
    if (resolvedBucket) {
      items.push({
        key: `bucket:${resolvedBucket}`,
        kind: "bucket",
        label: resolvedBucket,
      });
    }
  }

  if (includeProgress) {
    const total = countNonEmptyLines(source.checklist);
    if (total > 0) {
      items.push({
        key: "progress",
        kind: "progress",
        label: `${countCheckedLines(source.checklist)}/${total}`,
      });
    }
  }

  if (includeReminder && (source.start_reminder_enabled || source.end_reminder_enabled)) {
    items.push({
      key: "reminder",
      kind: "reminder",
      label: "Reminder",
    });
  }

  return items;
}
