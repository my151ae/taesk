"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineDay } from "@/app/(board)/_utils/timeline-helpers";
import { PREFETCH_CHUNK_DAYS } from "@/app/(board)/_components/timeline/desktopTimelineWindowing";
import {
  deriveLoadedRangeFromDays,
  deriveTimelineViewportStateFromAnchor,
  EMPTY_TIMELINE_VIEWPORT_STATE,
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

export const buildDesktopTimelinePrefetchSpans = ({
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

export function useDesktopTimelineCoordinator({
  loadedDays,
  anchorDayIso,
  dayRange,
  enabled,
  ensureTimelineRange,
}: {
  loadedDays: TimelineDay[];
  anchorDayIso: string;
  dayRange: number;
  enabled: boolean;
  ensureTimelineRange: (
    startIso: string,
    endIso: string,
    options?: { silent?: boolean },
  ) => Promise<unknown>;
}) {
  const [viewportState, setViewportState] = useState<TimelineViewportState>(
    EMPTY_TIMELINE_VIEWPORT_STATE,
  );
  const lastRequestedPrefetchRef = useRef<{ leading: string | null; trailing: string | null }>({
    leading: null,
    trailing: null,
  });

  useEffect(() => {
    if (!enabled) return;
    setViewportState((current) => {
      const next = deriveTimelineViewportStateFromAnchor({
        days: loadedDays,
        anchorDayIso,
        dayRange,
      });
      if (
        current.anchorDayIso === next.anchorDayIso &&
        current.windowStartIso === next.windowStartIso &&
        current.windowEndIso === next.windowEndIso &&
        current.nearLeadingEdge === next.nearLeadingEdge &&
        current.nearTrailingEdge === next.nearTrailingEdge
      ) {
        return current;
      }
      return next;
    });
  }, [anchorDayIso, dayRange, enabled, loadedDays]);

  const handleViewportStateChange = useCallback((next: TimelineViewportState) => {
    setViewportState((current) => {
      if (
        current.anchorDayIso === next.anchorDayIso &&
        current.windowStartIso === next.windowStartIso &&
        current.windowEndIso === next.windowEndIso &&
        current.nearLeadingEdge === next.nearLeadingEdge &&
        current.nearTrailingEdge === next.nearTrailingEdge
      ) {
        return current;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const spans = buildDesktopTimelinePrefetchSpans({
      viewportState,
      loadedDays,
    });
    spans.forEach((span) => {
      const signature = buildTimelinePrefetchSignature(span);
      if (lastRequestedPrefetchRef.current[span.direction] === signature) return;
      lastRequestedPrefetchRef.current[span.direction] = signature;
      void ensureTimelineRange(span.startIso, span.endIso, { silent: true });
    });
  }, [enabled, ensureTimelineRange, loadedDays, viewportState]);

  const calendarWindowRange = useMemo(
    () => buildCalendarWindowRangeFromViewportState(viewportState),
    [viewportState],
  );

  return {
    viewportState,
    handleViewportStateChange,
    calendarWindowRange,
  };
}
