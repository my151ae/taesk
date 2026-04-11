"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineDay } from "@/app/(board)/_utils/timeline-helpers";
import {
  deriveTimelineViewportStateFromAnchor,
  EMPTY_TIMELINE_VIEWPORT_STATE,
  type TimelineViewportState,
} from "@/app/(board)/_components/timeline/timelineViewportState";
import {
  buildCalendarWindowRangeFromViewportState,
  buildTimelinePrefetchSignature,
  buildTimelinePrefetchSpans,
} from "@/app/(board)/_components/timeline/timelineViewportHelpers";

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
    const spans = buildTimelinePrefetchSpans({
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
