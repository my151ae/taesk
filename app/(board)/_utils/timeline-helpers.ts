import type { DragEndEvent, DragMoveEvent } from "@dnd-kit/core";
import type { TimelineDay, TimelineEvent, TimelineBucketItem, TimelineOverdueItem, TimelineResponse, UserProfile } from '@/lib/api-types/timeline';
export type { TimelineDay, TimelineEvent, TimelineBucketItem, TimelineOverdueItem, TimelineResponse, UserProfile };
export type ExternalCalendarEntry = {
    id: string;
    eventId?: string;
    dayIso?: string;
    title: string;
    startMinutes: number;
    durationMinutes: number;
    isAllDay: boolean;
    source: 'google_calendar';
    startDate?: string | null;
    endDate?: string | null;
    displayTz?: string | null;
    calendarId?: string | null;
};

// Constants
export const DEFAULT_HOUR_HEIGHT = 40;
export const HOUR_HEIGHT = DEFAULT_HOUR_HEIGHT; // Legacy compatibility
export const getTimelineHeight = (hourHeight: number = DEFAULT_HOUR_HEIGHT) => hourHeight * 24;

export const getDisplayHours = (startHour: number = 5) => {
    return Array.from({ length: 24 }, (_, i) => {
        const hour = (startHour + i) % 24;
        return `${hour.toString().padStart(2, "0")}:00`;
    });
};

export const TIMELINE_HEIGHT = HOUR_HEIGHT * 24;
export const TIMELINE_MIN_VIEWPORT = HOUR_HEIGHT * 8;
export const AXIS_WIDTH = 80;
export const TIMELINE_HEADER_ESTIMATE = 64;
export const DEFAULT_TIMELINE_DAY_RANGE = 7;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const formatDayLabel = (isoDate: string, todayIso?: string) => {
    const [, month, day] = isoDate.split('-');
    const date = new Date(`${isoDate}T00:00:00Z`);
    const weekday = WEEKDAYS[date.getUTCDay()] ?? '';
    if (todayIso && isoDate === todayIso) {
        return `Today ${month}/${day} (${weekday})`;
    }
    return `${month}/${day} (${weekday})`;
};

export const buildAbMeta = (day: TimelineDay) => ({
    title: `A/B ${day.label}`,
    sections: [
        { bucket: `${day.key}_a`, label: 'A:Critical Task', helper: '' },
        { bucket: `${day.key}_b`, label: 'B:Stretch Task', helper: '' },
    ],
});

// Types


// Helper functions
export const minuteToPixels = (minutes: number, startHour: number = 5, hourHeight: number = DEFAULT_HOUR_HEIGHT) => {
    const startMinutes = startHour * 60;
    // Adjust minutes to be relative to startHour
    // If minutes < startMinutes, it means it's "next morning" (visually at bottom)
    // E.g. start=6:00 (360), time=1:00 (60). 60 < 360.
    // effectiveMinutes = 60 + 1440 = 1500.
    // 1500 - 360 = 1140.
    // (1140 / 60) * 40 = 19 * 40 = 760px.
    //
    // E.g. start=6:00 (360), time=7:00 (420). 420 >= 360.
    // effectiveMinutes = 420.
    // 420 - 360 = 60.
    // (60 / 60) * 40 = 40px.

    let effectiveMinutes = minutes;
    if (effectiveMinutes < startMinutes) {
        effectiveMinutes += 24 * 60;
    }

    return ((effectiveMinutes - startMinutes) / 60) * hourHeight;
};

export const pixelsToMinutes = (pixels: number, startHour: number = 0, hourHeight: number = DEFAULT_HOUR_HEIGHT): number => {
    // Reverse of minuteToPixels
    const relativeMinutes = (pixels / hourHeight) * 60;
    const startMinutes = startHour * 60;

    let totalMinutes = relativeMinutes + startMinutes;
    // Normalize to 0-1439
    if (totalMinutes >= 24 * 60) {
        totalMinutes -= 24 * 60;
    }

    const minutes = Math.round(totalMinutes);
    return Math.max(0, Math.min(24 * 60 - 1, minutes)); // Clamp to 0-1439
};

export const getMinutesFromTime = (value: string | null) => {
    if (!value) return null;
    const [hours, minutes] = value.split(":");
    const h = Number(hours ?? "0");
    const m = Number(minutes ?? "0");
    return h * 60 + m;
};


export const getDayDiff = (d1: string, d2: string) => {
    const t1 = new Date(d1).getTime();
    const t2 = new Date(d2).getTime();
    if (isNaN(t1) || isNaN(t2)) return 0;
    return Math.floor((t1 - t2) / (1000 * 60 * 60 * 24));
};

export const getIsoDateJst = (timestamp: string) => {
    const current = new Date(timestamp);
    const jst = new Date(current.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().split('T')[0];
};

export const getNowMinutesJst = (timestamp: string) => {
    const current = new Date(timestamp);
    const minutes = current.getUTCMinutes();
    const hours = (current.getUTCHours() + 9 + 24) % 24;
    return hours * 60 + minutes;
};

export const getMinutesJstFromIso = (timestamp: string) => getNowMinutesJst(timestamp);

export const minutesToTime = (value: number) => {
    const clamped = Math.max(0, Math.min(24 * 60 - 1, value));
    const hours = Math.floor(clamped / 60) % 24;
    const minutes = clamped % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
};

export const formatDuration = (minutes: number) => {
    if (minutes === 0) return '0m';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0) return `${h}h${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
};

export const detailedTimeLabel = (start: string | null, end: string | null, durationMinutes?: number) => {
    if (!start && !end) return 'Anytime';
    const toLabel = (value: string | null) => (value ? value.slice(0, 5) : '--:--');
    const label = `${toLabel(start)} - ${toLabel(end)}`;
    if (durationMinutes != null) {
        return `${label}[${formatDuration(durationMinutes)}]`;
    }
    return label;
};

export const timeLabel = (start: string | null, end: string | null) => {
    if (!start && !end) return 'Anytime';
    const toLabel = (value: string | null) => (value ? value.slice(0, 5) : '--:--');
    return `${toLabel(start)} – ${toLabel(end)}`;
};

export const withJstMidnight = (isoDate: string | null) => {
    if (!isoDate) return null;
    const base = isoDate.includes('T') ? isoDate.split('T')[0] : isoDate;
    const utc = new Date(`${base}T00:00:00+09:00`).toISOString();
    return utc;
};

export const toLocalDay = (value: string | null | undefined) => {
    if (!value) return null;
    try {
        return getIsoDateJst(value);
    } catch {
        const [day] = value.split('T');
        return day ?? value;
    }
};

export const pointerMinutesFromEvent = (
    event: DragEndEvent | DragMoveEvent,
    options?: {
        scrollTop?: number;
        columnRect?: { top: number; height: number };
        startHour?: number;
        hourHeight?: number;
    }
): number | null => {
    const scrollTop = options?.scrollTop ?? 0;
    const columnRect = options?.columnRect;
    const startHour = options?.startHour ?? 5;
    const hourHeight = options?.hourHeight ?? DEFAULT_HOUR_HEIGHT;
    const translated = event.active.rect.current?.translated;
    const sourceInitial = event.active.rect.current?.initial;
    const elementTop = translated?.top ?? (sourceInitial ? sourceInitial.top + event.delta.y : null);
    if (elementTop == null) return null;

    let relativeY: number;
    if (columnRect) {
        relativeY = elementTop - columnRect.top;
    } else {
        relativeY = elementTop - AXIS_WIDTH + scrollTop;
    }

    const maxHeight = columnRect?.height ?? getTimelineHeight(hourHeight);
    const clampedY = Math.max(0, Math.min(relativeY, maxHeight));

    // Use pixelsToMinutes which already handles startHour
    const minutes = pixelsToMinutes(clampedY, startHour, hourHeight);
    // Snap to 15m intervals
    const snapped = Math.round(minutes / 5) * 5;
    return Math.max(0, Math.min(23 * 60 + 45, snapped));
};

export type EventLayout = {
    left: string;
    width: string;
};

export type StackedTimelineItemKind = 'card' | 'calendar';

export type StackedTimelineLayoutItem = {
    id: string;
    kind: StackedTimelineItemKind;
    startMinutes: number;
    durationMinutes: number;
};

export type StackedEventPresentationMode = 'full-width' | 'split' | 'half-overlap' | 'light-overlap';

export type StackedEventLayout = EventLayout & {
    slotIndex: number;
    stackSize: number;
    clusterColumns: number;
    columnSpan: number;
    baseZIndex: number;
    presentationMode: StackedEventPresentationMode;
};

export type NormalizedTimelineLayoutItem<TEntry = unknown> = StackedTimelineLayoutItem & {
    key: string;
    listIndex: number;
    entry: TEntry;
};

type StackedLayoutDevice = 'desktop' | 'mobile';

type StackedLayoutOptions = {
    device?: StackedLayoutDevice;
};

type ClusterLayoutItem = StackedTimelineLayoutItem & {
    slotIndex: number;
    endMinutes: number;
};

const HIGH_OVERLAP_MIN_RATIO = 0.82;
const HIGH_OVERLAP_MAX_RATIO = 0.5;
const MEDIUM_OVERLAP_MIN_RATIO = 0.38;
const DESKTOP_SPLIT_START_DELTA_MINUTES = 10;
const MOBILE_SPLIT_START_DELTA_MINUTES = 6;
const DESKTOP_MEDIUM_START_DELTA_MINUTES = 40;
const MOBILE_MEDIUM_START_DELTA_MINUTES = 32;
const DESKTOP_MIN_EVENT_WIDTH_PERCENT = 24;
const MOBILE_MIN_EVENT_WIDTH_PERCENT = 30;

const PRESENTATION_FACTORS = {
    desktop: {
        split: { step: 1, width: 1 },
        'half-overlap': { step: 0.5, width: 1.5 },
        'light-overlap': { step: 0.72, width: 1.22 },
        'full-width': { step: 0, width: 1 },
    },
    mobile: {
        split: { step: 1, width: 1 },
        'half-overlap': { step: 0.64, width: 1.28 },
        'light-overlap': { step: 0.82, width: 1.12 },
        'full-width': { step: 0, width: 1 },
    },
} as const;

export const getStackedTimelineItemKey = (kind: StackedTimelineItemKind, id: string) => `${kind}:${id}`;

export const compareTimelineLayoutItems = (
    a: StackedTimelineLayoutItem,
    b: StackedTimelineLayoutItem
) => {
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    if (a.durationMinutes !== b.durationMinutes) return b.durationMinutes - a.durationMinutes;
    if (a.kind !== b.kind) return a.kind === 'calendar' ? -1 : 1;
    return a.id.localeCompare(b.id);
};

export const compareStackedTimelineLayoutItems = compareTimelineLayoutItems;

export const normalizeTimelineItems = (
    events: ReadonlyArray<TimelineEvent>,
    calendarEvents: ReadonlyArray<ExternalCalendarEntry>
): Array<NormalizedTimelineLayoutItem<TimelineEvent | ExternalCalendarEntry>> => {
    return [
        ...calendarEvents.map((calendarEvent, listIndex) => ({
            kind: 'calendar' as const,
            key: getStackedTimelineItemKey('calendar', calendarEvent.id),
            id: calendarEvent.id,
            listIndex,
            startMinutes: calendarEvent.startMinutes,
            durationMinutes: calendarEvent.durationMinutes,
            entry: calendarEvent,
        })),
        ...events.map((event, listIndex) => ({
            kind: 'card' as const,
            key: getStackedTimelineItemKey('card', event.card_id),
            id: event.card_id,
            listIndex,
            startMinutes: getMinutesFromTime(event.due_start ?? null) ?? 0,
            durationMinutes: event.durationMinutes ?? 60,
            entry: event,
        })),
    ].sort((a, b) => {
        const compared = compareTimelineLayoutItems(a, b);
        if (compared !== 0) return compared;
        if (a.listIndex !== b.listIndex) return a.listIndex - b.listIndex;
        return a.key.localeCompare(b.key);
    });
};

const getBaseZIndex = (kind: StackedTimelineItemKind) => (kind === 'card' ? 20 : 10);

const eventsOverlap = (a: StackedTimelineLayoutItem, b: StackedTimelineLayoutItem) => {
    const start = Math.max(a.startMinutes, b.startMinutes);
    const end = Math.min(a.startMinutes + a.durationMinutes, b.startMinutes + b.durationMinutes);
    return Math.max(0, end - start);
};

const getSplitStartDeltaMinutes = (device: StackedLayoutDevice) =>
    device === 'mobile' ? MOBILE_SPLIT_START_DELTA_MINUTES : DESKTOP_SPLIT_START_DELTA_MINUTES;

const getMediumStartDeltaMinutes = (device: StackedLayoutDevice) =>
    device === 'mobile' ? MOBILE_MEDIUM_START_DELTA_MINUTES : DESKTOP_MEDIUM_START_DELTA_MINUTES;

const getMinEventWidthPercent = (device: StackedLayoutDevice) =>
    device === 'mobile' ? MOBILE_MIN_EVENT_WIDTH_PERCENT : DESKTOP_MIN_EVENT_WIDTH_PERCENT;

const groupClusters = (sorted: ReadonlyArray<StackedTimelineLayoutItem>) => {
    const clusters: StackedTimelineLayoutItem[][] = [];
    let currentCluster: StackedTimelineLayoutItem[] = [];
    let clusterEnd = -1;

    sorted.forEach((item) => {
        const end = item.startMinutes + item.durationMinutes;
        if (currentCluster.length === 0) {
            currentCluster.push(item);
            clusterEnd = end;
            return;
        }

        if (item.startMinutes < clusterEnd) {
            currentCluster.push(item);
            clusterEnd = Math.max(clusterEnd, end);
            return;
        }

        clusters.push(currentCluster);
        currentCluster = [item];
        clusterEnd = end;
    });

    if (currentCluster.length > 0) {
        clusters.push(currentCluster);
    }

    return clusters;
};

const assignClusterSlots = (cluster: ReadonlyArray<StackedTimelineLayoutItem>): ClusterLayoutItem[] => {
    const slotEnds: number[] = [];
    return cluster.map((item) => {
        const slotIndex = slotEnds.findIndex((end) => end <= item.startMinutes);
        const nextSlotIndex = slotIndex === -1 ? slotEnds.length : slotIndex;
        slotEnds[nextSlotIndex] = item.startMinutes + item.durationMinutes;
        return {
            ...item,
            slotIndex: nextSlotIndex,
            endMinutes: item.startMinutes + item.durationMinutes,
        };
    });
};

const resolvePresentationMode = (
    overlapMetrics: Array<{ minRatio: number; maxRatio: number; startDelta: number }>,
    device: StackedLayoutDevice
): StackedEventPresentationMode => {
    if (overlapMetrics.length === 0) return 'full-width';

    const hasStrongOverlap = overlapMetrics.some(
        (metric) =>
            metric.minRatio >= HIGH_OVERLAP_MIN_RATIO &&
            metric.maxRatio >= HIGH_OVERLAP_MAX_RATIO &&
            metric.startDelta <= getSplitStartDeltaMinutes(device)
    );
    if (hasStrongOverlap) return 'split';

    const hasMediumOverlap = overlapMetrics.some(
        (metric) =>
            metric.minRatio >= MEDIUM_OVERLAP_MIN_RATIO &&
            metric.startDelta <= getMediumStartDeltaMinutes(device)
    );
    if (hasMediumOverlap) return 'half-overlap';

    return 'light-overlap';
};

const getMaxSafeColumnSpan = (
    item: ClusterLayoutItem,
    cluster: ReadonlyArray<ClusterLayoutItem>,
    clusterColumns: number
) => {
    let span = 1;

    for (let nextSlot = item.slotIndex + 1; nextSlot < clusterColumns; nextSlot += 1) {
        const hasCollisionInSlot = cluster.some((candidate) => {
            if (candidate.slotIndex !== nextSlot) return false;
            if (candidate.id === item.id && candidate.kind === item.kind) return false;
            return eventsOverlap(item, candidate) > 0;
        });

        if (hasCollisionInSlot) {
            break;
        }

        span += 1;
    }

    return span;
};

const clampColumnSpanForDevice = (
    columnSpan: number,
    slotIndex: number,
    clusterColumns: number,
    device: StackedLayoutDevice
) => {
    if (device !== 'mobile') return columnSpan;

    const remainingColumns = clusterColumns - slotIndex;
    return Math.max(1, Math.min(columnSpan, remainingColumns));
};

const buildGridLayout = (
    slotIndex: number,
    clusterColumns: number,
    columnSpan: number,
    presentationMode: StackedEventPresentationMode,
    device: StackedLayoutDevice
): Pick<StackedEventLayout, 'left' | 'width' | 'presentationMode'> => {
    if (clusterColumns <= 1 || presentationMode === 'full-width') {
        return {
            left: '0%',
            width: '100%',
            presentationMode: 'full-width',
        };
    }

    const columnWidth = 100 / clusterColumns;
    const baseLeftPercent = columnWidth * slotIndex;
    const baseWidthPercent = columnWidth * columnSpan;

    if (presentationMode === 'split') {
        return {
            left: `${baseLeftPercent}%`,
            width: `${Math.max(Math.min(baseWidthPercent, 100 - baseLeftPercent), 0)}%`,
            presentationMode,
        };
    }

    const factors = PRESENTATION_FACTORS[device][presentationMode];
    const overlapOffsetPercent = columnWidth * (1 - factors.step);
    const leftPercent = Math.max(0, baseLeftPercent - overlapOffsetPercent);
    const widthPercent = Math.min(100 - leftPercent, baseWidthPercent + overlapOffsetPercent);

    return {
        left: `${leftPercent}%`,
        width: `${Math.max(widthPercent, 0)}%`,
        presentationMode,
    };
};

export const calculateStackedEventLayout = (
    items: ReadonlyArray<StackedTimelineLayoutItem>,
    options?: StackedLayoutOptions
): Record<string, StackedEventLayout> => {
    const device = options?.device ?? 'desktop';
    const sorted = [...items].sort(compareTimelineLayoutItems);
    const clusters = groupClusters(sorted);
    const layout: Record<string, StackedEventLayout> = {};

    clusters.forEach((cluster) => {
        const slottedCluster = assignClusterSlots(cluster);
        const stackSize = slottedCluster.length;
        const clusterColumns = slottedCluster.reduce((max, item) => Math.max(max, item.slotIndex + 1), 1);

        slottedCluster.forEach((item) => {
            const key = getStackedTimelineItemKey(item.kind, item.id);
            const overlappingItems = slottedCluster.filter((candidate) => eventsOverlap(item, candidate) > 0);
            const minWidthPercent = getMinEventWidthPercent(device);
            const desiredColumnSpan = getMaxSafeColumnSpan(item, slottedCluster, clusterColumns);
            const columnSpan = clampColumnSpanForDevice(desiredColumnSpan, item.slotIndex, clusterColumns, device);

            const overlapMetrics = overlappingItems
                .filter((candidate) => candidate.id !== item.id || candidate.kind !== item.kind)
                .map((candidate) => {
                    const overlapMinutes = eventsOverlap(item, candidate);
                    const minRatio = overlapMinutes / Math.max(1, Math.min(item.durationMinutes, candidate.durationMinutes));
                    const maxRatio = overlapMinutes / Math.max(item.durationMinutes, candidate.durationMinutes);
                    const startDelta = Math.abs(candidate.startMinutes - item.startMinutes);
                    return {
                        overlapMinutes,
                        minRatio,
                        maxRatio,
                        startDelta,
                    };
                });

            let presentationMode = resolvePresentationMode(overlapMetrics, device);
            if (presentationMode === 'split' && (100 / clusterColumns) < minWidthPercent) {
                presentationMode = overlapMetrics.length > 0 ? 'half-overlap' : 'full-width';
            }

            let geometry = buildGridLayout(item.slotIndex, clusterColumns, columnSpan, presentationMode, device);
            const resolvedWidth = Number.parseFloat(geometry.width);
            if (Number.isFinite(resolvedWidth) && resolvedWidth < minWidthPercent && presentationMode !== 'light-overlap') {
                geometry = buildGridLayout(item.slotIndex, clusterColumns, columnSpan, 'light-overlap', device);
            }

            layout[key] = {
                ...geometry,
                slotIndex: item.slotIndex,
                stackSize,
                clusterColumns,
                columnSpan,
                baseZIndex: getBaseZIndex(item.kind),
            };
        });
    });

    return layout;
};

export const calculateEventLayout = (events: ReadonlyArray<TimelineEvent>): Record<string, EventLayout> => {
    // 1. Sort events by start time, then by duration (longer first)
    const sorted = [...events].sort((a, b) => {
        const aStart = getMinutesFromTime(a.due_start) ?? 0;
        const bStart = getMinutesFromTime(b.due_start) ?? 0;
        if (aStart !== bStart) return aStart - bStart;
        const aDur = a.durationMinutes ?? a.duration ?? 60;
        const bDur = b.durationMinutes ?? b.duration ?? 60;
        return bDur - aDur;
    });

    // 2. Group into connected components (clusters)
    const clusters: TimelineEvent[][] = [];
    let currentCluster: TimelineEvent[] = [];
    let clusterEnd = -1;

    sorted.forEach(event => {
        const start = getMinutesFromTime(event.due_start) ?? 0;
        const duration = event.durationMinutes ?? event.duration ?? 60;
        const end = start + duration;

        if (currentCluster.length === 0) {
            currentCluster.push(event);
            clusterEnd = end;
        } else {
            if (start < clusterEnd) {
                // Overlaps with cluster
                currentCluster.push(event);
                clusterEnd = Math.max(clusterEnd, end);
            } else {
                // New cluster
                clusters.push(currentCluster);
                currentCluster = [event];
                clusterEnd = end;
            }
        }
    });
    if (currentCluster.length > 0) clusters.push(currentCluster);

    // 3. Layout each cluster
    const layout: Record<string, EventLayout> = {};

    clusters.forEach(cluster => {
        // Column packing
        const columns: TimelineEvent[][] = [];
        cluster.forEach(event => {
            const start = getMinutesFromTime(event.due_start) ?? 0;
            let placed = false;
            for (let i = 0; i < columns.length; i++) {
                const lastInCol = columns[i][columns[i].length - 1];
                const lastEnd = (getMinutesFromTime(lastInCol.due_start) ?? 0) + (lastInCol.durationMinutes ?? lastInCol.duration ?? 60);
                if (lastEnd <= start) {
                    columns[i].push(event);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                columns.push([event]);
            }
        });

        const numCols = columns.length;
        const widthPercent = 100 / numCols;

        columns.forEach((col, colIndex) => {
            col.forEach(event => {
                layout[event.card_id] = {
                    left: `${colIndex * widthPercent}%`,
                    width: `${widthPercent}%`,
                };
            });
        });
    });

    return layout;
};
