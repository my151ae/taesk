import type { DragEndEvent, DragMoveEvent } from "@dnd-kit/core";
import type { TimelineDay, TimelineEvent, TimelineBucketItem, TimelineResponse, UserProfile } from '@/lib/api-types/timeline';
export type { TimelineDay, TimelineEvent, TimelineBucketItem, TimelineResponse, UserProfile };
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
export const HOUR_HEIGHT = 40;
export const HOURS = Array.from({ length: 24 }, (_, hour) => `${hour.toString().padStart(2, "0")}:00`);
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
        { bucket: `${day.key}_a`, label: `A: do on ${day.label}`, helper: 'Critical tasks' },
        { bucket: `${day.key}_b`, label: `B: if possible on ${day.label}`, helper: 'Stretch tasks' },
    ],
});

// Types


// Helper functions
export const minuteToPixels = (minutes: number) => (minutes / 60) * HOUR_HEIGHT;

export const getMinutesFromTime = (value: string | null) => {
    if (!value) return null;
    const [hours, minutes] = value.split(":");
    const h = Number(hours ?? "0");
    const m = Number(minutes ?? "0");
    return h * 60 + m;
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
    }
): number | null => {
    const scrollTop = options?.scrollTop ?? 0;
    const columnRect = options?.columnRect;
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

    const maxHeight = columnRect?.height ?? TIMELINE_HEIGHT;
    const clamped = Math.max(0, Math.min(relativeY, maxHeight));
    const minutes = Math.round((clamped / HOUR_HEIGHT) * 60 / 15) * 15;
    return Math.max(0, Math.min(23 * 60 + 45, minutes));
};

export type EventLayout = {
    left: string;
    width: string;
};

export const calculateEventLayout = (events: TimelineEvent[]): Record<string, EventLayout> => {
    // 1. Sort events by start time, then by duration (longer first)
    const sorted = [...events].sort((a, b) => {
        const aStart = getMinutesFromTime(a.due_start) ?? 0;
        const bStart = getMinutesFromTime(b.due_start) ?? 0;
        if (aStart !== bStart) return aStart - bStart;
        const aDur = a.durationMinutes ?? 60;
        const bDur = b.durationMinutes ?? 60;
        return bDur - aDur;
    });

    // 2. Group into connected components (clusters)
    const clusters: TimelineEvent[][] = [];
    let currentCluster: TimelineEvent[] = [];
    let clusterEnd = -1;

    sorted.forEach(event => {
        const start = getMinutesFromTime(event.due_start) ?? 0;
        const duration = event.durationMinutes ?? 60;
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
                const lastEnd = (getMinutesFromTime(lastInCol.due_start) ?? 0) + (lastInCol.durationMinutes ?? 60);
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
