"use client";

import { useCallback } from "react";
import { getDayDiff, getCurrentTimelineIsoDateJst, pixelsToMinutes } from "@/app/(board)/_utils/timeline-helpers";
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
    anchorDayIso: string;
    setAnchorDayIso: (isoDate: string) => void;
    fetchTimeline: (startOffset: number, options?: { silent?: boolean; range?: number }) => Promise<TimelineResponse | null>;
    updateUrlForTimeline: (args: TimelineUrlUpdateArgs) => void;
    timelineScrollRef: React.RefObject<HTMLDivElement | null>;
    dayWindowStartRef: React.MutableRefObject<number>;
    timelineStartHour?: number;
    hourHeight?: number;
    requestedFetchRange?: number;
}

export const resolveAnchorDayFromPayload = ({
    targetIso,
    payloadDays,
    currentTimelineIso,
}: {
    targetIso: string;
    payloadDays: TimelineResponse["days"] | undefined;
    currentTimelineIso: string;
}) => {
    if (!payloadDays?.length) {
        return { resolvedAnchorDayIso: targetIso, anchorIndex: 0, windowStartIndex: 0 };
    }

    const exactIndex = payloadDays.findIndex((day) => day.isoDate === targetIso);
    if (exactIndex >= 0) {
        return {
            resolvedAnchorDayIso: payloadDays[exactIndex]?.isoDate ?? targetIso,
            anchorIndex: exactIndex,
            windowStartIndex: exactIndex,
        };
    }

    const targetOffset = getDayDiff(targetIso, currentTimelineIso);
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    payloadDays.forEach((day, index) => {
        const distance = Math.abs(getDayDiff(day.isoDate, currentTimelineIso) - targetOffset);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
        }
    });

    return {
        resolvedAnchorDayIso: payloadDays[closestIndex]?.isoDate ?? targetIso,
        anchorIndex: closestIndex,
        windowStartIndex: closestIndex,
    };
};

export const hasPrefetchedNeighborsForDay = ({
    targetIso,
    payloadDays,
    currentTimelineIso,
}: {
    targetIso: string;
    payloadDays: TimelineResponse["days"] | undefined;
    currentTimelineIso: string;
}) => {
    if (!payloadDays?.length) return false;
    const targetOffset = getDayDiff(targetIso, currentTimelineIso);
    const offsets = new Set(payloadDays.map((day) => getDayDiff(day.isoDate, currentTimelineIso)));
    return offsets.has(targetOffset - 1) && offsets.has(targetOffset) && offsets.has(targetOffset + 1);
};

export function useTimelineNavigation({
    data,
    status,
    dayRange,
    activeDayIndex,
    setActiveDayIndex,
    anchorDayIso,
    setAnchorDayIso,
    fetchTimeline,
    updateUrlForTimeline,
    timelineScrollRef,
    dayWindowStartRef,
    timelineStartHour = 0,
    hourHeight = 40,
    requestedFetchRange,
}: UseTimelineNavigationProps) {
    const navStep = Math.max(1, dayRange - 1);
    const fetchRange = Math.max(requestedFetchRange ?? dayRange, 3);
    const currentTimelineIso = getCurrentTimelineIsoDateJst(timelineStartHour);

    const resolveAnchorDay = useCallback((targetIso: string, payloadDays: TimelineResponse["days"] | undefined) => {
        return resolveAnchorDayFromPayload({
            targetIso,
            payloadDays,
            currentTimelineIso,
        });
    }, [currentTimelineIso]);

    const hasPrefetchedNeighbors = useCallback((targetIso: string, payloadDays: TimelineResponse["days"] | undefined) => {
        return hasPrefetchedNeighborsForDay({
            targetIso,
            payloadDays,
            currentTimelineIso,
        });
    }, [currentTimelineIso]);

    const silentlyPrefetchAroundDay = useCallback(async (targetIso: string, payloadDays?: TimelineResponse["days"]) => {
        if (!targetIso || hasPrefetchedNeighbors(targetIso, payloadDays)) return;
        const targetOffset = getDayDiff(targetIso, currentTimelineIso);
        const startOffset = targetOffset - 1;
        const payload = await fetchTimeline(startOffset, { range: fetchRange, silent: true });
        const resolved = resolveAnchorDay(targetIso, payload?.days);
        if (resolved.resolvedAnchorDayIso) {
            setAnchorDayIso(resolved.resolvedAnchorDayIso);
            setActiveDayIndex(resolved.windowStartIndex);
        }
    }, [currentTimelineIso, fetchRange, fetchTimeline, hasPrefetchedNeighbors, resolveAnchorDay, setActiveDayIndex, setAnchorDayIso]);

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
        const targetOffset = getDayDiff(anchorDayIso, getCurrentTimelineIsoDateJst(timelineStartHour)) + delta;
        const targetPayload = await fetchTimeline(targetOffset, { range: fetchRange });
        const resolved = resolveAnchorDay(
            targetPayload?.days?.[0]?.isoDate ?? anchorDayIso,
            targetPayload?.days
        );
        const nextAnchorIso = resolved.resolvedAnchorDayIso;
        setAnchorDayIso(nextAnchorIso);
        setActiveDayIndex(resolved.windowStartIndex);
        updateUrlForTimeline({ date: nextAnchorIso, range: dayRange, time: getCurrentTime() });
    }, [anchorDayIso, dayRange, fetchRange, fetchTimeline, getCurrentTime, resolveAnchorDay, setActiveDayIndex, setAnchorDayIso, status, timelineStartHour, updateUrlForTimeline]);

    const goToDay = useCallback(async (targetIso: string) => {
        if (status === 'loading' || !targetIso) return;
        const localResolved = resolveAnchorDay(targetIso, data?.days);
        const localExactDay = data?.days?.find((day) => day.isoDate === targetIso) ?? null;
        if (localExactDay) {
            setAnchorDayIso(localResolved.resolvedAnchorDayIso);
            setActiveDayIndex(localResolved.windowStartIndex);
            updateUrlForTimeline({ date: localResolved.resolvedAnchorDayIso, range: dayRange, time: getCurrentTime() });
            void silentlyPrefetchAroundDay(localResolved.resolvedAnchorDayIso, data?.days);
            return;
        }
        const targetOffset = getDayDiff(targetIso, currentTimelineIso);
        const targetPayload = await fetchTimeline(targetOffset - 1, { range: fetchRange });
        const resolved = resolveAnchorDay(targetIso, targetPayload?.days);
        setAnchorDayIso(resolved.resolvedAnchorDayIso);
        setActiveDayIndex(resolved.windowStartIndex);
        updateUrlForTimeline({ date: resolved.resolvedAnchorDayIso, range: dayRange, time: getCurrentTime() });
        void silentlyPrefetchAroundDay(resolved.resolvedAnchorDayIso, targetPayload?.days);
    }, [currentTimelineIso, data?.days, dayRange, fetchRange, fetchTimeline, getCurrentTime, resolveAnchorDay, setActiveDayIndex, setAnchorDayIso, silentlyPrefetchAroundDay, status, updateUrlForTimeline]);

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
        const payload = await fetchTimeline(0, { range: fetchRange });
        setActiveDayIndex(0);
        const todayIso = payload?.days?.[0]?.isoDate ?? data?.days?.[0]?.isoDate;
        if (todayIso) {
            setAnchorDayIso(todayIso);
            const currentTime = getCurrentTime();
            updateUrlForTimeline({
                date: todayIso,
                range: dayRange,
                time: currentTime,
                method: 'push',
            });
        }
    }, [fetchRange, fetchTimeline, data, dayRange, updateUrlForTimeline, getCurrentTime, setActiveDayIndex, setAnchorDayIso]);

    const handleDayRangeChange = useCallback((newRange: number) => {
        const currentDay = data?.days?.[activeDayIndex] ?? data?.days?.find((day) => day.isoDate === anchorDayIso);
        if (currentDay) {
            updateUrlForTimeline({ date: currentDay.isoDate, range: newRange, time: getCurrentTime() });
        }
    }, [data, activeDayIndex, anchorDayIso, updateUrlForTimeline, getCurrentTime]);

    return {
        resolveAnchorDay,
        goToDay,
        handlePrevDay,
        handleNextDay,
        handlePrevDayRange,
        handleNextDayRange,
        handleTodayClick,
        handleDayRangeChange,
    };
}
