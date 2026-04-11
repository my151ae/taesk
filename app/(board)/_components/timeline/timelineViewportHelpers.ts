"use client";

import { PREFETCH_CHUNK_DAYS } from "@/app/(board)/_components/timeline/desktopTimelineWindowing";
import type { TimelineDay } from "@/app/(board)/_utils/timeline-helpers";
import {
  deriveLoadedRangeFromDays,
  type TimelineViewportState,
} from "@/app/(board)/_components/timeline/timelineViewportState";

const addDaysToIso = (isoDate: string, delta: number) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

export type TimelinePrefetchSpan = {
  direction: "leading" | "trailing";
  startIso: string;
  endIso: string;
};

export const buildTimelinePrefetchSpans = ({
  viewportState,
  loadedDays,
  chunkDays = PREFETCH_CHUNK_DAYS,
}: {
  viewportState: TimelineViewportState;
  loadedDays: TimelineDay[];
  chunkDays?: number;
}): TimelinePrefetchSpan[] => {
  const { firstLoadedIso, lastLoadedIso } = deriveLoadedRangeFromDays(loadedDays);
  const spans: TimelinePrefetchSpan[] = [];

  if (viewportState.nearLeadingEdge && firstLoadedIso) {
    spans.push({
      direction: "leading",
      startIso: addDaysToIso(firstLoadedIso, -chunkDays),
      endIso: addDaysToIso(firstLoadedIso, -1),
    });
  }

  if (viewportState.nearTrailingEdge && lastLoadedIso) {
    spans.push({
      direction: "trailing",
      startIso: addDaysToIso(lastLoadedIso, 1),
      endIso: addDaysToIso(lastLoadedIso, chunkDays),
    });
  }

  return spans;
};

export const buildTimelinePrefetchSignature = (span: TimelinePrefetchSpan) =>
  `${span.direction}:${span.startIso}:${span.endIso}`;

export const buildCalendarWindowRangeFromViewportState = (
  viewportState: TimelineViewportState,
) => ({
  windowStartIso: viewportState.windowStartIso,
  windowEndIso: viewportState.windowEndIso,
});
