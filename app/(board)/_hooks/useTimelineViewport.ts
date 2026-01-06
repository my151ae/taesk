"use client";

import { useState, useEffect, useMemo, RefObject } from "react";
import {
    TIMELINE_HEIGHT,
    TIMELINE_MIN_VIEWPORT,
    TIMELINE_HEADER_ESTIMATE,
    getNowMinutesJst,
    getIsoDateJst
} from "@/app/(board)/_utils/timeline-helpers";

interface UseTimelineViewportProps {
    timelineHeaderRef: RefObject<HTMLDivElement | null>;
    serverNow?: string;
}

export function useTimelineViewport({ timelineHeaderRef, serverNow }: UseTimelineViewportProps) {
    const [viewportHeight, setViewportHeight] = useState<number | null>(null);
    const [timelineHeaderHeight, setTimelineHeaderHeight] = useState(TIMELINE_HEADER_ESTIMATE);
    const [liveNowMinutes, setLiveNowMinutes] = useState<number | null>(null);
    const [liveNowIsoDate, setLiveNowIsoDate] = useState<string | null>(null);

    // Viewport height tracking
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const updateHeight = () => setViewportHeight(window.innerHeight);
        updateHeight();
        window.addEventListener('resize', updateHeight);
        return () => window.removeEventListener('resize', updateHeight);
    }, []);

    // Header height tracking
    useEffect(() => {
        const headerEl = timelineHeaderRef.current;
        if (!headerEl) return;
        const updateHeight = () => setTimelineHeaderHeight(headerEl.offsetHeight);
        updateHeight();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateHeight);
            return () => window.removeEventListener('resize', updateHeight);
        }
        const observer = new ResizeObserver(() => updateHeight());
        observer.observe(headerEl);
        return () => observer.disconnect();
    }, [timelineHeaderRef]);

    // Live "Now" indicator tracking
    useEffect(() => {
        if (!serverNow) return;
        const updateNow = () => {
            const nowIso = new Date().toISOString();
            setLiveNowMinutes(getNowMinutesJst(nowIso));
            setLiveNowIsoDate(getIsoDateJst(nowIso));
        };
        updateNow();
        const interval = window.setInterval(updateNow, 60_000);
        return () => clearInterval(interval);
    }, [serverNow]);

    const timelineViewportHeight = useMemo(() => {
        if (viewportHeight == null) return Math.max(TIMELINE_MIN_VIEWPORT, TIMELINE_HEIGHT);
        const available = viewportHeight - timelineHeaderHeight;
        return Math.max(available, TIMELINE_MIN_VIEWPORT, TIMELINE_HEIGHT);
    }, [viewportHeight, timelineHeaderHeight]);

    return {
        viewportHeight,
        timelineHeaderHeight,
        timelineViewportHeight,
        liveNowMinutes,
        liveNowIsoDate,
    };
}
