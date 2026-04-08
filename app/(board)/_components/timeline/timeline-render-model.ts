import {
  buildAbMeta,
  calculateStackedEventLayout,
  compareStackedTimelineLayoutItems,
  getStackedTimelineItemKey,
  normalizeTimelineItems,
  type ExternalCalendarEntry,
  type TimelineBucketItem,
  type TimelineDay,
  type TimelineEvent,
  type TimelineOverdueItem,
} from "@/app/(board)/_utils/timeline-helpers";
import { buildOverlayCardData, findOverlayBucketEntry, findOverlayOverdueEntry } from "@/app/(board)/_utils/timeline-overlay";

type StackedLayoutDevice = "desktop" | "mobile";

export type DesktopTimelineGapKind = "leading" | "between" | "trailing";

export type DesktopTimelineDayColumn = {
  kind: "day";
  key: string;
  day: TimelineDay;
};

export type DesktopTimelineGapColumn = {
  kind: "gap";
  key: string;
  gapKind: DesktopTimelineGapKind;
  hiddenIsos: string[];
};

export type DesktopTimelineRenderColumn =
  | DesktopTimelineDayColumn
  | DesktopTimelineGapColumn;

type AllDaySegmentSeed = {
  id: string;
  title: string;
  start: number;
  end: number;
  entry: ExternalCalendarEntry;
  startDate?: string | null;
  endDate?: string | null;
  displayTz?: string | null;
  calendarId?: string | null;
};

export type TimelineAllDaySegment = AllDaySegmentSeed & {
  row: number;
  startColumn: number;
  endColumn: number;
  startDayIndex: number;
  endDayIndex: number;
};

const EMPTY_SEGMENTS: TimelineAllDaySegment[] = [];
const EMPTY_ACTIVE_BUCKETS: Record<string, TimelineBucketItem[]> = {};
const DAY_COLUMN_TEMPLATE = "minmax(0, 1fr)";
const GAP_COLUMN_TEMPLATE = "1.75rem";

export type MobileTimelineDayState = {
  day: TimelineDay;
  events: TimelineEvent[];
  calendarTimed: ExternalCalendarEntry[];
  calendarAllDay: ExternalCalendarEntry[];
  abMeta: ReturnType<typeof buildAbMeta>;
  activeBuckets: Record<string, TimelineBucketItem[]>;
  indicatorVisible: boolean;
  indicatorPosition: number;
  overlayBucketEntry: ReturnType<typeof findOverlayBucketEntry>;
  overlayOverdueEntry: ReturnType<typeof findOverlayOverdueEntry>;
  overlayOverdueCard: TimelineOverdueItem | TimelineBucketItem | null;
  overlayCardData: ReturnType<typeof buildOverlayCardData>;
};

export const buildStackedTimelineColumnLayout = ({
  events,
  calendarEvents,
  device,
  hourHeight,
}: {
  events: ReadonlyArray<TimelineEvent>;
  calendarEvents: ReadonlyArray<ExternalCalendarEntry>;
  device: StackedLayoutDevice;
  hourHeight: number;
}) => {
  const combinedItems = normalizeTimelineItems(events, calendarEvents).sort(compareStackedTimelineLayoutItems);
  const stackedLayout = calculateStackedEventLayout(combinedItems, { device, hourHeight });

  return {
    combinedItems,
    stackedLayout,
  };
};

export const buildVisibleDays = ({
  days,
  activeDayIndex,
  dayRange,
}: {
  days: TimelineDay[];
  activeDayIndex: number;
  dayRange: number;
}) => {
  const dayCount = Math.min(dayRange, Math.max(0, days.length - activeDayIndex));
  const visibleDays = days.slice(activeDayIndex, activeDayIndex + dayCount);

  return {
    dayCount,
    visibleDays,
    gridTemplateColumns: `repeat(${visibleDays.length}, minmax(0, 1fr))`,
  };
};

const uniqueSortedHiddenDayIsos = ({
  candidateDays,
  hiddenDayIsos,
}: {
  candidateDays: TimelineDay[];
  hiddenDayIsos: readonly string[];
}) => {
  const candidateSet = new Set(candidateDays.map((day) => day.isoDate));
  return Array.from(new Set(hiddenDayIsos))
    .filter((isoDate) => candidateSet.has(isoDate))
    .sort((left, right) => left.localeCompare(right));
};

export const buildDesktopTimelineHiddenDaysForHide = ({
  candidateDays,
  hiddenDayIsos,
  targetIso,
}: {
  candidateDays: TimelineDay[];
  hiddenDayIsos: readonly string[];
  targetIso: string;
}) => {
  const normalized = uniqueSortedHiddenDayIsos({ candidateDays, hiddenDayIsos });
  const visibleSet = new Set(candidateDays.map((day) => day.isoDate));
  if (!visibleSet.has(targetIso) || normalized.includes(targetIso)) {
    return normalized;
  }
  return [...normalized, targetIso].sort((left, right) => left.localeCompare(right));
};

export const buildDesktopTimelineHiddenDaysForReveal = ({
  candidateDays,
  hiddenDayIsos,
  revealIso,
  pushHiddenIso,
}: {
  candidateDays: TimelineDay[];
  hiddenDayIsos: readonly string[];
  revealIso: string;
  pushHiddenIso: string | null;
}) => {
  const normalized = uniqueSortedHiddenDayIsos({ candidateDays, hiddenDayIsos });
  if (!normalized.includes(revealIso)) {
    return normalized;
  }

  const next = normalized.filter((isoDate) => isoDate !== revealIso);
  if (pushHiddenIso && candidateDays.some((day) => day.isoDate === pushHiddenIso) && pushHiddenIso !== revealIso && !next.includes(pushHiddenIso)) {
    next.push(pushHiddenIso);
  }

  return next.sort((left, right) => left.localeCompare(right));
};

export const buildDesktopTimelineColumns = ({
  candidateDays,
  hiddenDayIsos,
  targetVisibleCount,
}: {
  candidateDays: TimelineDay[];
  hiddenDayIsos: readonly string[];
  targetVisibleCount: number;
}) => {
  const normalizedHiddenDayIsos = uniqueSortedHiddenDayIsos({ candidateDays, hiddenDayIsos });
  const hiddenSet = new Set(normalizedHiddenDayIsos);
  const clampedVisibleCount = Math.max(0, Math.round(targetVisibleCount));

  const visibleDays: TimelineDay[] = [];
  let lastVisibleIndex = -1;
  for (let index = 0; index < candidateDays.length; index += 1) {
    const day = candidateDays[index];
    if (hiddenSet.has(day.isoDate)) continue;
    visibleDays.push(day);
    lastVisibleIndex = index;
    if (visibleDays.length >= clampedVisibleCount) break;
  }

  let scanEndIndex = lastVisibleIndex;
  if (lastVisibleIndex >= 0) {
    for (let index = lastVisibleIndex + 1; index < candidateDays.length; index += 1) {
      const day = candidateDays[index];
      if (!hiddenSet.has(day.isoDate)) break;
      scanEndIndex = index;
    }
  }

  const scannedDays = scanEndIndex >= 0 ? candidateDays.slice(0, scanEndIndex + 1) : [];
  const columns: DesktopTimelineRenderColumn[] = [];
  let hiddenRun: string[] = [];

  const flushHiddenRun = () => {
    if (!hiddenRun.length) return;
    const previousColumn = columns[columns.length - 1] ?? null;
    const gapKind: DesktopTimelineGapKind =
      previousColumn?.kind === "day"
        ? "between"
        : columns.length === 0
          ? "leading"
          : "trailing";

    columns.push({
      kind: "gap",
      key: `gap:${hiddenRun[0]}:${hiddenRun[hiddenRun.length - 1]}`,
      gapKind,
      hiddenIsos: hiddenRun,
    });
    hiddenRun = [];
  };

  scannedDays.forEach((day) => {
    if (hiddenSet.has(day.isoDate)) {
      hiddenRun.push(day.isoDate);
      return;
    }

    flushHiddenRun();
    columns.push({
      kind: "day",
      key: day.key,
      day,
    });
  });

  flushHiddenRun();

  if (columns.length >= 2) {
    columns.forEach((column, index) => {
      if (column.kind !== "gap" || column.gapKind !== "between") return;
      if (index === columns.length - 1) {
        columns[index] = { ...column, gapKind: "trailing" };
      }
    });
  }

  const gridTemplateColumns = columns
    .map((column) => (column.kind === "day" ? DAY_COLUMN_TEMPLATE : GAP_COLUMN_TEMPLATE))
    .join(" ");

  return {
    visibleDays,
    columns,
    gridTemplateColumns,
    normalizedHiddenDayIsos,
  };
};

export const buildTimelineInteractionLock = ({
  activeDragCardId,
  activeResize,
  contextMenuCardId,
  selectedSlotVisible,
  pointerPreviewVisible,
}: {
  activeDragCardId: string | null;
  activeResize?: unknown;
  contextMenuCardId: string | null;
  selectedSlotVisible?: boolean;
  pointerPreviewVisible?: boolean;
}) =>
  Boolean(
    activeDragCardId ||
      activeResize ||
      contextMenuCardId ||
      selectedSlotVisible ||
      pointerPreviewVisible
  );

export const buildTimelineOverlayState = ({
  abBuckets,
  overdue,
  events,
  activeDragCardId,
  defaultTimelineDuration,
}: {
  abBuckets: Record<string, TimelineBucketItem[]>;
  overdue: TimelineOverdueItem[];
  events: TimelineEvent[];
  activeDragCardId: string | null;
  defaultTimelineDuration: number;
}) => {
  const overlayBucketEntry = findOverlayBucketEntry(abBuckets, activeDragCardId);
  const overlayOverdueEntry = findOverlayOverdueEntry(overdue, activeDragCardId);
  const overlayTimelineEvent = events.find((event) => event.card_id === activeDragCardId) ?? null;

  return {
    overlayBucketEntry,
    overlayOverdueEntry,
    overlayTimelineEvent,
    overlayCardData: buildOverlayCardData({
      timelineEvent: overlayTimelineEvent,
      bucketEntry: overlayBucketEntry,
      overdueEntry: overlayOverdueEntry,
      defaultTimelineDuration,
    }),
  };
};

export const buildActiveBuckets = ({
  activeDay,
  abBuckets,
}: {
  activeDay: TimelineDay | null;
  abBuckets: Record<string, TimelineBucketItem[]>;
}) => {
  if (!activeDay) return {} as Record<string, TimelineBucketItem[]>;
  return Object.fromEntries(
    Object.entries(abBuckets || {}).filter(([key]) => key.startsWith(activeDay.key))
  );
};

export const buildDesktopAllDayState = ({
  renderColumns,
  calendarAllDayByDay,
  rowHeight,
  rowGap = 6,
  minHeight = 48,
}: {
  renderColumns: DesktopTimelineRenderColumn[];
  calendarAllDayByDay: Record<string, ExternalCalendarEntry[]>;
  rowHeight: number;
  rowGap?: number;
  minHeight?: number;
}) => {
  const visibleDays = renderColumns.flatMap((column) => (column.kind === "day" ? [column.day] : []));
  const hasAllDayEvents = visibleDays.some((day) => (calendarAllDayByDay[day.isoDate]?.length ?? 0) > 0);
  const allDayLayout = hasAllDayEvents
    ? buildAllDayLayout({ renderColumns, calendarAllDayByDay })
    : { segments: EMPTY_SEGMENTS, rows: 0 };

  return {
    hasAllDayEvents,
    allDayLayout,
    allDayMinHeight: Math.max(minHeight, allDayLayout.rows * (rowHeight + rowGap) + 10),
  };
};

export const buildAllDayLayout = ({
  renderColumns,
  calendarAllDayByDay,
}: {
  renderColumns: DesktopTimelineRenderColumn[];
  calendarAllDayByDay: Record<string, ExternalCalendarEntry[]>;
}) => {
  if (!renderColumns.length) {
    return { segments: [] as TimelineAllDaySegment[], rows: 0 };
  }

  type TimelineAllDaySeed = AllDaySegmentSeed & {
    startColumn: number;
    endColumn: number;
    startDayIndex: number;
    endDayIndex: number;
  };

  const segments: TimelineAllDaySeed[] = [];
  const ongoing = new Map<string, TimelineAllDaySeed>();
  let visibleDayIndex = -1;

  const flushOngoing = () => {
    ongoing.forEach((segment) => segments.push(segment));
    ongoing.clear();
  };

  renderColumns.forEach((column, columnIndex) => {
    if (column.kind === "gap") {
      flushOngoing();
      return;
    }

    const day = column.day;
    visibleDayIndex += 1;
    const items = calendarAllDayByDay[day.isoDate] ?? [];
    const present = new Set<string>();

    items.forEach((item) => {
      const key = item.eventId ?? item.id ?? getStackedTimelineItemKey("calendar", item.id);
      present.add(key);
      const existing = ongoing.get(key);
      if (existing) {
        if (columnIndex === existing.endColumn + 1) {
          existing.endColumn = columnIndex;
          existing.endDayIndex = visibleDayIndex;
        } else {
          segments.push(existing);
          ongoing.set(key, {
            id: key,
            title: item.title || "Google予定",
            start: visibleDayIndex,
            end: visibleDayIndex,
            startColumn: columnIndex,
            endColumn: columnIndex,
            startDayIndex: visibleDayIndex,
            endDayIndex: visibleDayIndex,
            entry: item,
            startDate: item.startDate ?? item.dayIso ?? null,
            endDate: item.endDate ?? null,
            displayTz: item.displayTz ?? null,
            calendarId: item.calendarId ?? null,
          });
        }
      } else {
        ongoing.set(key, {
          id: key,
          title: item.title || "Google予定",
          start: visibleDayIndex,
          end: visibleDayIndex,
          startColumn: columnIndex,
          endColumn: columnIndex,
          startDayIndex: visibleDayIndex,
          endDayIndex: visibleDayIndex,
          entry: item,
          startDate: item.startDate ?? item.dayIso ?? null,
          endDate: item.endDate ?? null,
          displayTz: item.displayTz ?? null,
          calendarId: item.calendarId ?? null,
        });
      }
    });

    const toClose: string[] = [];
    ongoing.forEach((segment, key) => {
      if (!present.has(key)) {
        segments.push(segment);
        toClose.push(key);
      }
    });
    toClose.forEach((key) => ongoing.delete(key));
  });

  flushOngoing();

  segments.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const rowEnds: number[] = [];
  const placed = segments.map((segment) => {
    let row = rowEnds.findIndex((end) => segment.startColumn > end);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(segment.endColumn);
    } else {
      rowEnds[row] = segment.endColumn;
    }
    return { ...segment, row };
  });

  return {
    segments: placed,
    rows: rowEnds.length,
  };
};

export const buildMobileTimelineViewState = ({
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
}) => {
  const anchorIndex = Math.max(0, days.findIndex((day) => day.isoDate === anchorDayIso));
  const safeAnchorIndex = anchorIndex >= 0 ? anchorIndex : 0;
  const windowStart = Math.max(0, Math.min(days.length - 3, safeAnchorIndex - 1));
  const windowDays = days.slice(windowStart, windowStart + 3);
  const anchorWindowIndex = Math.max(0, windowDays.findIndex((day) => day.isoDate === anchorDayIso));

  if (!windowDays.length) {
    return {
      anchorDayIso: null,
      anchorWindowIndex: 0,
      windowDayStates: [] as MobileTimelineDayState[],
    };
  }

  const windowDayStates: MobileTimelineDayState[] = windowDays.map((day) => {
    const events = eventsByDay[day.isoDate] ?? [];
    const calendarTimed = calendarEventsByDay[day.isoDate] ?? [];
    const calendarAllDay = calendarAllDayByDay[day.isoDate] ?? [];
    const activeBuckets = buildActiveBuckets({ activeDay: day, abBuckets });
    const { overlayBucketEntry, overlayOverdueEntry, overlayCardData } = buildTimelineOverlayState({
      abBuckets: activeBuckets,
      overdue,
      events,
      activeDragCardId,
      defaultTimelineDuration: 0,
    });

    return {
      day,
      events,
      calendarTimed,
      calendarAllDay,
      abMeta: buildAbMeta(day),
      activeBuckets,
      indicatorVisible: indicatorTop != null && indicatorDayIso === day.isoDate,
      indicatorPosition: indicatorTop ?? 0,
      overlayBucketEntry,
      overlayOverdueEntry,
      overlayOverdueCard: overlayOverdueEntry?.item ?? null,
      overlayCardData,
    };
  });

  return {
    anchorDayIso: windowDays[anchorWindowIndex]?.isoDate ?? windowDays[0]?.isoDate ?? null,
    anchorWindowIndex,
    windowDayStates,
  };
};

export const shiftIsoDate = (iso?: string | null, deltaDays = 0) => {
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map((part) => Number(part));
  if (!year || !month || !day) return iso;
  const shifted = new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + deltaDays));
  return shifted.toISOString().split("T")[0];
};

export const formatShortDate = (iso?: string | null) => {
  if (!iso) return null;
  const [, month, day] = iso.split("-");
  if (!month || !day) return null;
  return `${Number(month)}/${Number(day)}`;
};

export const formatAllDayRange = ({
  segment,
  visibleDays,
}: {
  segment: { startDate?: string | null; endDate?: string | null; start: number; end: number };
  visibleDays: TimelineDay[];
}) => {
  const visibleStartIso = visibleDays[segment.start]?.isoDate ?? null;
  const visibleEndIso = visibleDays[segment.end]?.isoDate ?? null;
  const startIso = segment.startDate ?? visibleStartIso;
  const endExclusive = segment.endDate ?? null;
  const endIso = endExclusive ? shiftIsoDate(endExclusive, -1) : visibleEndIso ?? startIso;
  const startLabel = formatShortDate(startIso);
  const endLabel = formatShortDate(endIso);
  if (startLabel && endLabel && startLabel !== endLabel) return `${startLabel}–${endLabel}`;
  return startLabel ?? endLabel;
};

export const formatAllDayInlineLabel = ({
  title,
  rangeLabel,
}: {
  title?: string | null;
  rangeLabel?: string | null;
}) => {
  const safeTitle = title?.trim() || "Google予定";
  return rangeLabel ? `${rangeLabel} ${safeTitle}` : safeTitle;
};

export const formatAllDayMeta = ({
  entry,
  fallbackIsoDate,
}: {
  entry: ExternalCalendarEntry;
  fallbackIsoDate?: string | null;
}) => {
  const startIso = entry.startDate ?? entry.dayIso ?? fallbackIsoDate ?? null;
  const endIso = entry.endDate ? shiftIsoDate(entry.endDate, -1) : startIso;
  const startLabel = formatShortDate(startIso);
  const endLabel = formatShortDate(endIso);
  const range =
    startLabel && endLabel && startLabel !== endLabel
      ? `${startLabel}–${endLabel}`
      : startLabel ?? endLabel;
  const tzLabel = entry.displayTz && entry.displayTz !== "Asia/Tokyo" ? entry.displayTz : null;
  return [range, tzLabel].filter(Boolean).join(" · ");
};
