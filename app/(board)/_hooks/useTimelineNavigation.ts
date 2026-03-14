"use client";

import { useCallback } from "react";
import { pixelsToMinutes } from "@/app/(board)/_utils/timeline-helpers";
import type { TimelineResponse } from "@/app/(board)/_utils/timeline-helpers";
import type { UrlUpdateMethod } from "@/app/(board)/_hooks/useTimelineUrlState";

type TimelineUrlUpdateArgs = {
    date?: string | null;
    range: number;
    time?: number | null;
    method?: UrlUpdateMethod;
};

interface UseTimelineNavigationProps {
    data: TimelineResponse | null;
    status: string;
    dayRange: number;
    activeDayIndex: number;
    setActiveDayIndex: (index: number) => void;
    fetchTimeline: (startOffset: number) => Promise<TimelineResponse | null>;
    updateUrlForTimeline: (args: TimelineUrlUpdateArgs) => void;
    timelineScrollRef: React.RefObject<HTMLDivElement | null>;
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
    updateUrlForTimeline,
    timelineScrollRef,
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

    const navigateByDays = useCallback(async (delta: number) => {
        if (status === 'loading' || delta === 0) return;

        const desiredIndex = activeDayIndex + delta;

        if (delta < 0) {
            if (desiredIndex >= 0) {
                setActiveDayIndex(desiredIndex);
                const targetDay = data?.days?.[desiredIndex];
                if (targetDay) {
                    updateUrlForTimeline({ date: targetDay.isoDate, range: dayRange, time: getCurrentTime() });
                }
                return;
            }

            const baseStart = data?.startOffset ?? dayWindowStartRef.current ?? 0;
            const payload = await fetchTimeline(baseStart + delta);
            const nextDaysLength = payload?.days?.length ?? 0;
            const newIndex = clampActiveDayIndex(nextDaysLength, activeDayIndex);
            setActiveDayIndex(newIndex);
            const targetDay = payload?.days?.[newIndex];
            if (targetDay) {
                updateUrlForTimeline({ date: targetDay.isoDate, range: dayRange, time: getCurrentTime() });
            }
            return;
        }

        if (!data?.days?.length) return;

        const lastStartIndex = Math.max(0, data.days.length - dayRange);
        if (desiredIndex <= lastStartIndex) {
            setActiveDayIndex(desiredIndex);
            const targetDay = data?.days?.[desiredIndex];
            if (targetDay) {
                updateUrlForTimeline({ date: targetDay.isoDate, range: dayRange, time: getCurrentTime() });
            }
            return;
        }

        const baseStart = data?.startOffset ?? dayWindowStartRef.current ?? 0;
        const payload = await fetchTimeline(baseStart + delta);
        const nextDaysLength = payload?.days?.length ?? 0;
        const newIndex = clampActiveDayIndex(nextDaysLength, activeDayIndex);
        setActiveDayIndex(newIndex);
        const targetDay = payload?.days?.[newIndex];
        if (targetDay) {
            updateUrlForTimeline({ date: targetDay.isoDate, range: dayRange, time: getCurrentTime() });
        }
    }, [activeDayIndex, clampActiveDayIndex, data, dayRange, dayWindowStartRef, fetchTimeline, getCurrentTime, setActiveDayIndex, status, updateUrlForTimeline]);

    const handlePrevDay = useCallback(async () => {
        await navigateByDays(-1);
    }, [navigateByDays]);

    const handleNextDay = useCallback(async () => {
        await navigateByDays(1);
    }, [navigateByDays]);

    const handlePrevDayRange = useCallback(async () => {
        await navigateByDays(-navStep);
    }, [navigateByDays, navStep]);

    const handleNextDayRange = useCallback(async () => {
        await navigateByDays(navStep);
    }, [navigateByDays, navStep]);

    const handleTodayClick = useCallback(async () => {
        const payload = await fetchTimeline(0);
        setActiveDayIndex(0);
        const todayIso = payload?.days?.[0]?.isoDate ?? data?.days?.[0]?.isoDate;
        if (todayIso) {
            const currentTime = getCurrentTime();
            updateUrlForTimeline({
                date: todayIso,
                range: dayRange,
                time: currentTime,
                method: 'push',
            });
        }
    }, [fetchTimeline, data, dayRange, updateUrlForTimeline, getCurrentTime, setActiveDayIndex]);

    const handleDayRangeChange = useCallback((newRange: number) => {
        const currentDay = data?.days?.[activeDayIndex];
        if (currentDay) {
            updateUrlForTimeline({ date: currentDay.isoDate, range: newRange, time: getCurrentTime() });
        }
    }, [data, activeDayIndex, updateUrlForTimeline, getCurrentTime]);

    return {
        handlePrevDay,
        handleNextDay,
        handlePrevDayRange,
        handleNextDayRange,
        handleTodayClick,
        handleDayRangeChange,
    };
}
