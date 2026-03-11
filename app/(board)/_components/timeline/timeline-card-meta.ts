import { formatDuration, timeLabel, toLocalDay } from "@/app/(board)/_utils/timeline-helpers";

type CardMetaSource = {
  due_date?: string | null;
  due_start?: string | null;
  due_end?: string | null;
  duration?: number | null;
  durationMinutes?: number | null;
};

type BuildCardTimeTextOptions = {
  includeDate?: boolean;
  includeTime?: boolean;
  includeDuration?: boolean;
  showAnytime?: boolean;
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
