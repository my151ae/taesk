"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  TimelineBucketItem,
  TimelineDay,
  TimelineEvent,
  TimelineOverdueItem,
} from "@/app/(board)/_utils/timeline-helpers";
import {
  buildCalendarWindowRangeFromViewportState,
  buildTimelinePrefetchSignature,
  buildTimelinePrefetchSpans,
} from "@/app/(board)/_components/timeline/timelineViewportHelpers";
import { useMobileTimelineViewportState } from "@/app/(board)/_hooks/useMobileTimelineViewportState";

export function useMobileTimelineCoordinator({
  loadedDays,
  anchorDayIso,
  dayRange,
  enabled,
  eventsByDay,
  abBuckets,
  overdue,
  indicatorTop,
  indicatorDayIso,
  ensureTimelineRange,
}: {
  loadedDays: TimelineDay[];
  anchorDayIso: string | null;
  dayRange: number;
  enabled: boolean;
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  overdue: TimelineOverdueItem[];
  indicatorTop: number | null;
  indicatorDayIso: string | null;
  ensureTimelineRange: (
    startIso: string,
    endIso: string,
    options?: { silent?: boolean },
  ) => Promise<unknown>;
}) {
  const viewportState = useMobileTimelineViewportState({
    enabled,
    days: loadedDays,
    anchorDayIso,
    dayRange,
    eventsByDay,
    abBuckets,
    overdue,
    indicatorTop,
    indicatorDayIso,
  });
  const lastRequestedPrefetchRef = useRef<{ leading: string | null; trailing: string | null }>({
    leading: null,
    trailing: null,
  });

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
    calendarWindowRange,
  };
}
