"use client";

import type { TimelineDay } from "@/app/(board)/_utils/timeline-helpers";

export const NORMAL_OVERSCAN_DAYS = 3;
export const INTERACTION_OVERSCAN_DAYS = 5;
export const PREFETCH_EDGE_DAYS = 3;
export const PREFETCH_CHUNK_DAYS = 7;
export const ANCHOR_SWITCH_THRESHOLD = 0.5;

export type DesktopTimelineWindowMetrics = {
  renderStartIndex: number;
  renderEndIndex: number;
  leftSpacerWidth: number;
  rightSpacerWidth: number;
  totalStripWidth: number;
};

export type DesktopTimelineWindowState = {
  anchorIso: string | null;
  windowStartIso: string | null;
  windowEndIso: string | null;
  nearLeftEdge: boolean;
  nearRightEdge: boolean;
  firstLoadedIso: string | null;
  lastLoadedIso: string | null;
};

export const resolveDesktopTimelineWindowMetrics = ({
  scrollLeft,
  viewportWidth,
  columnWidth,
  loadedDayCount,
  dayRange,
  isInteractionActive,
}: {
  scrollLeft: number;
  viewportWidth: number;
  columnWidth: number;
  loadedDayCount: number;
  dayRange: number;
  isInteractionActive: boolean;
}): DesktopTimelineWindowMetrics => {
  const overscanDays = isInteractionActive
    ? INTERACTION_OVERSCAN_DAYS
    : NORMAL_OVERSCAN_DAYS;
  const safeViewportWidth = viewportWidth > 0 ? viewportWidth : 1200;
  const safeColumnWidth = columnWidth > 0 ? columnWidth : safeViewportWidth / Math.max(1, dayRange);
  const renderStartIndex = Math.max(
    0,
    Math.floor(scrollLeft / safeColumnWidth) - overscanDays,
  );
  const renderEndIndex = Math.min(
    loadedDayCount,
    Math.ceil((scrollLeft + safeViewportWidth) / safeColumnWidth) + overscanDays,
  );

  return {
    renderStartIndex,
    renderEndIndex,
    leftSpacerWidth: renderStartIndex * safeColumnWidth,
    rightSpacerWidth: Math.max(0, (loadedDayCount - renderEndIndex) * safeColumnWidth),
    totalStripWidth: Math.max(
      safeColumnWidth * Math.max(loadedDayCount, dayRange),
      safeViewportWidth,
    ),
  };
};

export const resolveDesktopTimelineAnchorIso = ({
  scrollLeft,
  columnWidth,
  loadedDays,
  threshold = ANCHOR_SWITCH_THRESHOLD,
}: {
  scrollLeft: number;
  columnWidth: number;
  loadedDays: TimelineDay[];
  threshold?: number;
}) => {
  if (!loadedDays.length || columnWidth <= 0) return null;
  const rawIndex = Math.floor(scrollLeft / columnWidth + threshold);
  const anchorIndex = Math.max(0, Math.min(loadedDays.length - 1, rawIndex));
  return loadedDays[anchorIndex]?.isoDate ?? null;
};

export const resolveDesktopTimelineWindowState = ({
  anchorDayIso,
  loadedDays,
  scrollLeft,
  columnWidth,
  dayRange,
  prefetchEdgeDays = PREFETCH_EDGE_DAYS,
}: {
  anchorDayIso: string;
  loadedDays: TimelineDay[];
  scrollLeft: number;
  columnWidth: number;
  dayRange: number;
  prefetchEdgeDays?: number;
}): DesktopTimelineWindowState => {
  if (!loadedDays.length) {
    return {
      anchorIso: null,
      windowStartIso: null,
      windowEndIso: null,
      nearLeftEdge: false,
      nearRightEdge: false,
      firstLoadedIso: null,
      lastLoadedIso: null,
    };
  }

  const anchorIndex = loadedDays.findIndex((day) => day.isoDate === anchorDayIso);
  const safeAnchorIndex = anchorIndex >= 0 ? anchorIndex : 0;
  const safeColumnWidth = columnWidth > 0 ? columnWidth : 1;
  const visibleStartIndex = Math.max(
    0,
    Math.min(loadedDays.length - 1, Math.floor(scrollLeft / safeColumnWidth)),
  );
  const visibleEndIndex = Math.max(
    visibleStartIndex,
    Math.min(loadedDays.length - 1, visibleStartIndex + Math.max(1, dayRange) - 1),
  );

  return {
    anchorIso: loadedDays[safeAnchorIndex]?.isoDate ?? null,
    windowStartIso: loadedDays[visibleStartIndex]?.isoDate ?? null,
    windowEndIso: loadedDays[visibleEndIndex]?.isoDate ?? null,
    nearLeftEdge: visibleStartIndex < prefetchEdgeDays,
    nearRightEdge: loadedDays.length - visibleEndIndex - 1 < prefetchEdgeDays,
    firstLoadedIso: loadedDays[0]?.isoDate ?? null,
    lastLoadedIso: loadedDays[loadedDays.length - 1]?.isoDate ?? null,
  };
};
