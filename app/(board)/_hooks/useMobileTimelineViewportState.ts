"use client";

import { useMemo } from "react";
import type {
  TimelineBucketItem,
  TimelineDay,
  TimelineEvent,
  TimelineOverdueItem,
} from "@/app/(board)/_utils/timeline-helpers";
import {
  adaptMobileTimelineViewStateToViewportState,
  deriveTimelineViewportStateFromAnchor,
  EMPTY_TIMELINE_VIEWPORT_STATE,
  type TimelineViewportState,
} from "@/app/(board)/_components/timeline/timelineViewportState";

type ResolveMobileTimelineViewportStateArgs = {
  enabled: boolean;
  days: TimelineDay[];
  anchorDayIso: string | null;
  dayRange: number;
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  overdue: TimelineOverdueItem[];
  indicatorTop: number | null;
  indicatorDayIso: string | null;
};

export const resolveMobileTimelineViewportState = ({
  enabled,
  days,
  anchorDayIso,
  dayRange,
  eventsByDay,
  abBuckets,
  overdue,
  indicatorTop,
  indicatorDayIso,
}: ResolveMobileTimelineViewportStateArgs): TimelineViewportState => {
  if (!enabled) {
    return EMPTY_TIMELINE_VIEWPORT_STATE;
  }

  const adapted = adaptMobileTimelineViewStateToViewportState({
    days,
    anchorDayIso,
    eventsByDay,
    calendarEventsByDay: {},
    calendarAllDayByDay: {},
    abBuckets,
    overdue,
    indicatorTop,
    indicatorDayIso,
    activeDragCardId: null,
  });

  if (adapted.windowStartIso && adapted.windowEndIso) {
    return adapted;
  }

  return deriveTimelineViewportStateFromAnchor({
    days,
    anchorDayIso,
    dayRange,
  });
};

export function useMobileTimelineViewportState(args: ResolveMobileTimelineViewportStateArgs) {
  const {
    enabled,
    days,
    anchorDayIso,
    dayRange,
    eventsByDay,
    abBuckets,
    overdue,
    indicatorTop,
    indicatorDayIso,
  } = args;

  return useMemo(
    () =>
      resolveMobileTimelineViewportState({
        enabled,
        days,
        anchorDayIso,
        dayRange,
        eventsByDay,
        abBuckets,
        overdue,
        indicatorTop,
        indicatorDayIso,
      }),
    [
      abBuckets,
      anchorDayIso,
      dayRange,
      days,
      enabled,
      eventsByDay,
      indicatorDayIso,
      indicatorTop,
      overdue,
    ],
  );
}
