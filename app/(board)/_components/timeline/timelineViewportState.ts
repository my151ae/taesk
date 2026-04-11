"use client";

import type {
  ExternalCalendarEntry,
  TimelineBucketItem,
  TimelineDay,
  TimelineEvent,
  TimelineOverdueItem,
} from "@/app/(board)/_utils/timeline-helpers";
import {
  PREFETCH_EDGE_DAYS,
  type DesktopTimelineWindowState,
} from "@/app/(board)/_components/timeline/desktopTimelineWindowing";
import { buildMobileTimelineViewState } from "@/app/(board)/_components/timeline/timeline-render-model";

export type TimelineViewportState = {
  anchorDayIso: string | null;
  windowStartIso: string | null;
  windowEndIso: string | null;
  nearLeadingEdge: boolean;
  nearTrailingEdge: boolean;
};

export const EMPTY_TIMELINE_VIEWPORT_STATE: TimelineViewportState = {
  anchorDayIso: null,
  windowStartIso: null,
  windowEndIso: null,
  nearLeadingEdge: false,
  nearTrailingEdge: false,
};

export const deriveLoadedRangeFromDays = (days: TimelineDay[]) => ({
  firstLoadedIso: days[0]?.isoDate ?? null,
  lastLoadedIso: days[days.length - 1]?.isoDate ?? null,
});

export const deriveTimelineViewportStateFromAnchor = ({
  days,
  anchorDayIso,
  dayRange,
  prefetchEdgeDays = PREFETCH_EDGE_DAYS,
}: {
  days: TimelineDay[];
  anchorDayIso: string | null;
  dayRange: number;
  prefetchEdgeDays?: number;
}): TimelineViewportState => {
  if (!days.length) return EMPTY_TIMELINE_VIEWPORT_STATE;

  const anchorIndex = Math.max(0, days.findIndex((day) => day.isoDate === anchorDayIso));
  const safeAnchorIndex = anchorIndex >= 0 ? anchorIndex : 0;
  const safeDayRange = Math.max(1, dayRange);
  const windowStartIndex = Math.max(0, Math.min(days.length - 1, safeAnchorIndex));
  const windowEndIndex = Math.max(
    windowStartIndex,
    Math.min(days.length - 1, windowStartIndex + safeDayRange - 1),
  );

  return {
    anchorDayIso: days[safeAnchorIndex]?.isoDate ?? null,
    windowStartIso: days[windowStartIndex]?.isoDate ?? null,
    windowEndIso: days[windowEndIndex]?.isoDate ?? null,
    nearLeadingEdge: windowStartIndex < prefetchEdgeDays,
    nearTrailingEdge: days.length - windowEndIndex - 1 < prefetchEdgeDays,
  };
};

export const adaptDesktopWindowStateToViewportState = (
  state: DesktopTimelineWindowState,
): TimelineViewportState => ({
  anchorDayIso: state.anchorIso,
  windowStartIso: state.windowStartIso,
  windowEndIso: state.windowEndIso,
  nearLeadingEdge: state.nearLeftEdge,
  nearTrailingEdge: state.nearRightEdge,
});

export const adaptMobileTimelineViewStateToViewportState = ({
  days,
  anchorDayIso,
  eventsByDay,
  calendarEventsByDay,
  calendarAllDayByDay,
  abBuckets,
  overdue,
  indicatorTop,
  indicatorDayIso,
  activeDragCardId,
  prefetchEdgeDays = PREFETCH_EDGE_DAYS,
}: {
  days: TimelineDay[];
  anchorDayIso: string | null;
  eventsByDay: Record<string, TimelineEvent[]>;
  calendarEventsByDay: Record<string, ExternalCalendarEntry[]>;
  calendarAllDayByDay: Record<string, ExternalCalendarEntry[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  overdue: TimelineOverdueItem[];
  indicatorTop: number | null;
  indicatorDayIso: string | null;
  activeDragCardId: string | null;
  prefetchEdgeDays?: number;
}): TimelineViewportState => {
  const mobileState = buildMobileTimelineViewState({
    days,
    anchorDayIso,
    eventsByDay,
    calendarEventsByDay,
    calendarAllDayByDay,
    abBuckets,
    overdue,
    indicatorTop,
    indicatorDayIso,
    activeDragCardId,
  });

  const windowStartIso = mobileState.windowDayStates[0]?.day.isoDate ?? null;
  const windowEndIso =
    mobileState.windowDayStates[mobileState.windowDayStates.length - 1]?.day.isoDate ?? null;
  const windowStartIndex = windowStartIso
    ? Math.max(0, days.findIndex((day) => day.isoDate === windowStartIso))
    : -1;
  const windowEndIndex = windowEndIso
    ? Math.max(0, days.findIndex((day) => day.isoDate === windowEndIso))
    : -1;

  return {
    anchorDayIso: mobileState.anchorDayIso,
    windowStartIso,
    windowEndIso,
    nearLeadingEdge: windowStartIndex >= 0 ? windowStartIndex < prefetchEdgeDays : false,
    nearTrailingEdge:
      windowEndIndex >= 0 ? days.length - windowEndIndex - 1 < prefetchEdgeDays : false,
  };
};
