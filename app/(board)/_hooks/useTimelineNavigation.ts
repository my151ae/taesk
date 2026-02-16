"use client";

import { useCallback } from "react";
import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { pixelsToMinutes } from "@/app/(board)/_utils/timeline-helpers";
import type { TimelineResponse } from "@/app/(board)/_utils/timeline-helpers";

interface UseTimelineNavigationProps {
    data: TimelineResponse | null;
    status: string;
    dayRange: number;
    activeDayIndex: number;
    setActiveDayIndex: (index: number) => void;
    fetchTimeline: (startOffset: number) => Promise<TimelineResponse | null>;
    updateUrl: (date: string, range: number, time?: number) => void;
    timelineScrollRef: React.RefObject<HTMLDivElement | null>;
    router: AppRouterInstance;
    dayWindowStartRef: React.MutableRefObject<number>;
    timelineStartHour?: number;
    hourHeight?: number;
}

export function useTimelineNavigation({
    data,
    status,
    dayRange,
    activeDayIndex,
    setActiveDayIndex,
    fetchTimeline,
    updateUrl,
    timelineScrollRef,
    router,
    dayWindowStartRef,
    timelineStartHour = 0,
    hourHeight = 40,
}: UseTimelineNavigationProps) {
    const navStep = Math.max(1, dayRange - 1);

    const clampActiveDayIndex = useCallback((nextLength: number, desired?: number) => {
        if (!nextLength) return 0;
        const maxStart = Math.max(0, nextLength - dayRange);
        if (typeof desired === 'number') {
            return Math.min(Math.max(0, desired), maxStart);
        }
        return Math.min(activeDayIndex, maxStart);
    }, [activeDayIndex, dayRange]);

    const getCurrentTime = useCallback(() => {
        const currentScrollTop = timelineScrollRef.current?.scrollTop ?? 0;
        return pixelsToMinutes(currentScrollTop, timelineStartHour, hourHeight);
    }, [timelineScrollRef, timelineStartHour, hourHeight]);

    const handlePrevDay = useCallback(async () => {
        if (status === 'loading') return;
        const desiredIndex = activeDayIndex - navStep;

        if (desiredIndex >= 0) {
            const newIndex = desiredIndex;
            setActiveDayIndex(newIndex);
            const targetDay = data?.days?.[newIndex];
            if (targetDay) updateUrl(targetDay.isoDate, dayRange, getCurrentTime());
            return;
        }

        const baseStart = data?.startOffset ?? dayWindowStartRef.current ?? 0;
        const payload = await fetchTimeline(baseStart - navStep);
        const nextDaysLength = payload?.days?.length ?? 0;
        const newIndex = clampActiveDayIndex(nextDaysLength, activeDayIndex);
        setActiveDayIndex(newIndex);
        const targetDay = payload?.days?.[newIndex];
        if (targetDay) updateUrl(targetDay.isoDate, dayRange, getCurrentTime());
    }, [activeDayIndex, navStep, clampActiveDayIndex, data, fetchTimeline, status, dayRange, updateUrl, getCurrentTime, dayWindowStartRef, setActiveDayIndex]);

    const handleNextDay = useCallback(async () => {
        if (status === 'loading' || !data?.days?.length) return;
        const lastStartIndex = Math.max(0, data.days.length - dayRange);
        const desiredIndex = activeDayIndex + navStep;

        if (desiredIndex <= lastStartIndex) {
            const newIndex = desiredIndex;
            setActiveDayIndex(newIndex);
            const targetDay = data?.days?.[newIndex];
            if (targetDay) updateUrl(targetDay.isoDate, dayRange, getCurrentTime());
            return;
        }

        const baseStart = data?.startOffset ?? dayWindowStartRef.current ?? 0;
        const payload = await fetchTimeline(baseStart + navStep);
        const nextDaysLength = payload?.days?.length ?? 0;
        const newIndex = clampActiveDayIndex(nextDaysLength, activeDayIndex);
        setActiveDayIndex(newIndex);
        const targetDay = payload?.days?.[newIndex];
        if (targetDay) updateUrl(targetDay.isoDate, dayRange, getCurrentTime());
    }, [activeDayIndex, navStep, clampActiveDayIndex, data, fetchTimeline, status, dayRange, updateUrl, getCurrentTime, dayWindowStartRef, setActiveDayIndex]);

    const handleTodayClick = useCallback(async () => {
        const payload = await fetchTimeline(0);
        setActiveDayIndex(0);
        const todayIso = payload?.days?.[0]?.isoDate ?? data?.days?.[0]?.isoDate;
        if (todayIso) {
            const params = new URLSearchParams();
            params.set('date', todayIso);
            params.set('range', String(dayRange));
            const currentTime = getCurrentTime();
            if (currentTime >= 0) params.set('time', String(currentTime));
            router.push(`${window.location.pathname}?${params.toString()}`, { scroll: false });
        }
    }, [fetchTimeline, data, dayRange, router, getCurrentTime, setActiveDayIndex]);

    const handleDayRangeChange = useCallback((newRange: number) => {
        const currentDay = data?.days?.[activeDayIndex];
        if (currentDay) {
            updateUrl(currentDay.isoDate, newRange, getCurrentTime());
        }
    }, [data, activeDayIndex, updateUrl, getCurrentTime]);

    return {
        handlePrevDay,
        handleNextDay,
        handleTodayClick,
        handleDayRangeChange,
    };
}
