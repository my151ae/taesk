import type { DragEndEvent, DragMoveEvent } from "@dnd-kit/core";

// Constants
export const HOUR_HEIGHT = 40;
export const HOURS = Array.from({ length: 24 }, (_, hour) => `${hour.toString().padStart(2, "0")}:00`);
export const TIMELINE_HEIGHT = HOUR_HEIGHT * 24;
export const TIMELINE_MIN_VIEWPORT = HOUR_HEIGHT * 8;
export const AXIS_WIDTH = 80;
export const TIMELINE_HEADER_ESTIMATE = 64;

export const AB_CARD_META: Record<string, { title: string; sections: Array<{ bucket: string; label: string; helper: string }> }> = {
    today: {
        title: 'A/B Today',
        sections: [
            { bucket: 'today_a', label: 'A: do today (not scheduled)', helper: 'Critical tasks' },
            { bucket: 'today_b', label: 'B: if possible today', helper: 'Stretch tasks' },
        ],
    },
    tomorrow: {
        title: 'A/B Tomorrow',
        sections: [
            { bucket: 'tomorrow_a', label: 'A: do tomorrow', helper: 'Planned focus' },
            { bucket: 'tomorrow_b', label: 'B: if possible tomorrow', helper: 'Backlog' },
        ],
    },
};

// Types
export type UserProfile = {
    id: string;
    username: string | null;
    display_name: string | null;
    full_name: string | null;
    avatar_url: string | null;
    email: string | null;
};

export interface TimelineDay {
    key: string;
    label: string;
    isoDate: string;
}

export interface TimelineEvent {
    card_id: string;
    due_date: string;
    due_start: string | null;
    due_end: string | null;
    durationMinutes: number | null;
    title: string;
    tags: string[];
    priority: string | null;
    checked: boolean;
    short_id: string | null;
    slug: string | null;
}

export interface TimelineBucketItem {
    card_id: string;
    title: string;
    due_date: string | null;
    due_start: string | null;
    due_end: string | null;
    checked: boolean;
    tags: string[];
    short_id: string | null;
    slug: string | null;
    bucketPosition: number | null;
}

export interface TimelineResponse {
    days: TimelineDay[];
    events: TimelineEvent[];
    abBuckets: Record<string, TimelineBucketItem[]>;
    serverNow: string;
}

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
    const [day] = value.split('T');
    return day ?? value;
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
