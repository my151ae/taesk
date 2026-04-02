import type { TimelineEvent } from "@/app/(board)/_utils/timeline-helpers";
import { getMinutesFromTime } from "@/app/(board)/_utils/timeline-helpers";

const NEAR_START_WINDOW_MINUTES = 60;

type TimelineEventTone = {
  backgroundClass: string;
  borderClassName?: string;
  titleBackgroundClassName?: string;
  titleClassName?: string;
};

const DEFAULT_TONE: TimelineEventTone = {
  backgroundClass: "bg-gradient-to-r from-white from-40% to-white/10",
};

const PRE_START_TONES: readonly TimelineEventTone[] = [
  {
    backgroundClass: "bg-gradient-to-r from-amber-50 from-40% to-white/10",
    borderClassName: "border-amber-200",
  },
  {
    backgroundClass: "bg-gradient-to-r from-yellow-50 from-40% to-white/10",
    borderClassName: "border-yellow-300",
  },
  {
    backgroundClass: "bg-gradient-to-r from-yellow-100 from-40% to-white/10",
    borderClassName: "border-yellow-400",
  },
  {
    backgroundClass: "bg-gradient-to-r from-amber-100 from-40% to-white/10",
    borderClassName: "border-amber-400",
  },
];

const IN_PROGRESS_TONES: readonly TimelineEventTone[] = [
  {
    backgroundClass: "bg-gradient-to-r from-rose-50 from-40% to-white/10",
    borderClassName: "border-rose-200",
  },
  {
    backgroundClass: "bg-gradient-to-r from-rose-100 from-40% to-white/10",
    borderClassName: "border-rose-300",
  },
  {
    backgroundClass: "bg-gradient-to-r from-red-100 from-40% to-white/10",
    borderClassName: "border-red-300",
  },
];

const POST_END_TONE: TimelineEventTone = {
  backgroundClass: "bg-gradient-to-r from-red-200 from-40% to-red-50/30",
  borderClassName: "border-red-500",
};

function pickTone(stages: readonly TimelineEventTone[], progress: number) {
  const clamped = Math.max(0, Math.min(progress, 0.9999));
  const index = Math.min(stages.length - 1, Math.floor(clamped * stages.length));
  return stages[index] ?? stages[stages.length - 1] ?? DEFAULT_TONE;
}

export function resolveTimelineEventTone(
  event: Pick<TimelineEvent, "due_date" | "due_start" | "due_end" | "durationMinutes">,
  currentIsoDate: string | null,
  currentMinutes: number | null,
): TimelineEventTone {
  if (!event.due_date || !event.due_start || !currentIsoDate || currentMinutes == null) {
    return DEFAULT_TONE;
  }

  const startMinutes = getMinutesFromTime(event.due_start);
  if (startMinutes == null) {
    return DEFAULT_TONE;
  }

  const parsedEndMinutes = getMinutesFromTime(event.due_end);
  const endMinutes =
    parsedEndMinutes ??
    (event.durationMinutes != null && event.durationMinutes > 0
      ? startMinutes + event.durationMinutes
      : startMinutes + 60);

  if (currentIsoDate < event.due_date) {
    return DEFAULT_TONE;
  }

  if (currentIsoDate > event.due_date) {
    return POST_END_TONE;
  }

  if (currentMinutes >= endMinutes) {
    return POST_END_TONE;
  }

  if (currentMinutes >= startMinutes) {
    const duration = Math.max(endMinutes - startMinutes, 1);
    return pickTone(IN_PROGRESS_TONES, (currentMinutes - startMinutes) / duration);
  }

  const nearStartAt = startMinutes - NEAR_START_WINDOW_MINUTES;
  if (currentMinutes <= nearStartAt) {
    return DEFAULT_TONE;
  }

  return pickTone(PRE_START_TONES, (currentMinutes - nearStartAt) / NEAR_START_WINDOW_MINUTES);
}
