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

export type TimelineAllDaySegment = AllDaySegmentSeed & { row: number };

const EMPTY_SEGMENTS: TimelineAllDaySegment[] = [];
const EMPTY_ACTIVE_BUCKETS: Record<string, TimelineBucketItem[]> = {};

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
  visibleDays,
  calendarAllDayByDay,
  rowHeight,
  rowGap = 6,
  minHeight = 48,
}: {
  visibleDays: TimelineDay[];
  calendarAllDayByDay: Record<string, ExternalCalendarEntry[]>;
  rowHeight: number;
  rowGap?: number;
  minHeight?: number;
}) => {
  const hasAllDayEvents = visibleDays.some((day) => (calendarAllDayByDay[day.isoDate]?.length ?? 0) > 0);
  const allDayLayout = hasAllDayEvents
    ? buildAllDayLayout({ visibleDays, calendarAllDayByDay })
    : { segments: EMPTY_SEGMENTS, rows: 0 };

  return {
    hasAllDayEvents,
    allDayLayout,
    allDayMinHeight: Math.max(minHeight, allDayLayout.rows * (rowHeight + rowGap) + 10),
  };
};

export const buildAllDayLayout = ({
  visibleDays,
  calendarAllDayByDay,
}: {
  visibleDays: TimelineDay[];
  calendarAllDayByDay: Record<string, ExternalCalendarEntry[]>;
}) => {
  if (!visibleDays.length) {
    return { segments: [] as TimelineAllDaySegment[], rows: 0 };
  }

  const segments: AllDaySegmentSeed[] = [];
  const ongoing = new Map<string, AllDaySegmentSeed>();

  visibleDays.forEach((day, idx) => {
    const items = calendarAllDayByDay[day.isoDate] ?? [];
    const present = new Set<string>();

    items.forEach((item) => {
      const key = item.eventId ?? item.id ?? getStackedTimelineItemKey("calendar", item.id);
      present.add(key);
      const existing = ongoing.get(key);
      if (existing) {
        if (idx === existing.end + 1) {
          existing.end = idx;
        } else {
          segments.push(existing);
          ongoing.set(key, {
            id: key,
            title: item.title || "Google予定",
            start: idx,
            end: idx,
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
          start: idx,
          end: idx,
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

  ongoing.forEach((segment) => segments.push(segment));

  segments.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const rowEnds: number[] = [];
  const placed = segments.map((segment) => {
    let row = rowEnds.findIndex((end) => segment.start > end);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(segment.end);
    } else {
      rowEnds[row] = segment.end;
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
