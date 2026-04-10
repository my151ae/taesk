"use client";

import { useCallback, useRef } from "react";
import { getDayDiff, getCurrentTimelineIsoDateJst } from "@/app/(board)/_utils/timeline-helpers";
import type { TimelineResponse } from "@/app/(board)/_utils/timeline-helpers";
import type { UrlUpdateMethod } from "@/app/(board)/_hooks/useTimelineUrlState";

type TimelineUrlUpdateArgs = {
  date?: string | null;
  method?: UrlUpdateMethod;
};

interface UseTimelineNavigationProps {
  data: TimelineResponse | null;
  dayRange: number;
  activeDayIndex: number;
  setActiveDayIndex: (index: number) => void;
  anchorDayIso: string;
  setAnchorDayIso: (isoDate: string) => void;
  fetchTimeline: (
    startOffset: number,
    options?: { silent?: boolean; range?: number },
  ) => Promise<TimelineResponse | null>;
  updateUrlForTimeline: (args: TimelineUrlUpdateArgs) => void;
  timelineStartHour?: number;
  requestedFetchRange?: number;
  syncActiveDayIndex?: boolean;
}

const clampIndex = (index: number, length: number) => {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
};

const addDaysToIso = (isoDate: string, delta: number) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

const resolveClosestLoadedIso = (days: TimelineResponse["days"], targetIso: string) => {
  if (!days.length) return null;
  const exact = days.find((day) => day.isoDate === targetIso)?.isoDate;
  if (exact) return exact;
  const firstAfterIndex = days.findIndex((day) => getDayDiff(day.isoDate, targetIso) >= 0);
  if (firstAfterIndex >= 0) {
    return days[clampIndex(firstAfterIndex, days.length)]?.isoDate ?? null;
  }
  return days[days.length - 1]?.isoDate ?? null;
};

export function useTimelineNavigation({
  data,
  dayRange,
  activeDayIndex,
  setActiveDayIndex,
  anchorDayIso,
  setAnchorDayIso,
  fetchTimeline,
  updateUrlForTimeline,
  timelineStartHour = 0,
  requestedFetchRange,
  syncActiveDayIndex = true,
}: UseTimelineNavigationProps) {
  const navStep = Math.max(1, dayRange);
  const fetchRange = Math.max(requestedFetchRange ?? dayRange, dayRange, 7);
  const currentTimelineIso = getCurrentTimelineIsoDateJst(timelineStartHour);
  const lastVisibleAnchorRef = useRef<string | null>(null);

  const syncAnchor = useCallback(
    (nextIsoDate: string, method: UrlUpdateMethod = "replace") => {
      if (!nextIsoDate) return;
      setAnchorDayIso(nextIsoDate);
      const nextIndex = data?.days?.findIndex((day) => day.isoDate === nextIsoDate) ?? -1;
      if (syncActiveDayIndex && nextIndex >= 0) {
        setActiveDayIndex(nextIndex);
      }
      updateUrlForTimeline({ date: nextIsoDate, method });
    },
    [data?.days, setActiveDayIndex, setAnchorDayIso, syncActiveDayIndex, updateUrlForTimeline],
  );

  const navigateByDays = useCallback(
    async (delta: number, method: UrlUpdateMethod = "replace") => {
      if (!delta) return;

      const days = data?.days ?? [];
      const targetIso = addDaysToIso(anchorDayIso, delta);
      const cachedTarget = days.find((day) => day.isoDate === targetIso)?.isoDate ?? null;

      if (cachedTarget) {
        syncAnchor(cachedTarget, method);
        return;
      }

      const targetOffset = getDayDiff(targetIso, currentTimelineIso);
      const targetPayload = await fetchTimeline(targetOffset, { range: fetchRange, silent: true });
      const nextDays = targetPayload?.days ?? [];
      const nextIso = resolveClosestLoadedIso(nextDays, targetIso);

      if (nextIso) {
        syncAnchor(nextIso, method);
      }
    },
    [
      anchorDayIso,
      currentTimelineIso,
      data?.days,
      fetchRange,
      fetchTimeline,
      syncAnchor,
    ],
  );

  const goToDay = useCallback(
    async (targetIso: string, method: UrlUpdateMethod = "push") => {
      if (!targetIso) return;
      const cached = data?.days?.find((day) => day.isoDate === targetIso);
      if (cached) {
        syncAnchor(cached.isoDate, method);
        return;
      }

      const targetOffset = getDayDiff(targetIso, currentTimelineIso);
      const targetPayload = await fetchTimeline(targetOffset, { range: fetchRange, silent: true });
      const resolvedTargetIso = resolveClosestLoadedIso(targetPayload?.days ?? [], targetIso) ?? targetIso;
      syncAnchor(resolvedTargetIso, method);
    },
    [currentTimelineIso, data?.days, fetchRange, fetchTimeline, syncAnchor],
  );

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
    await goToDay(currentTimelineIso, "push");
  }, [currentTimelineIso, goToDay]);

  const handleDayRangeChange = useCallback(
    (newRange: number) => {
      if (newRange > 0) {
        updateUrlForTimeline({ date: anchorDayIso });
      }
    },
    [anchorDayIso, updateUrlForTimeline],
  );

  const handleVisibleAnchorChange = useCallback(
    (nextIsoDate: string) => {
      if (!nextIsoDate || nextIsoDate === anchorDayIso) return;
      if (lastVisibleAnchorRef.current === nextIsoDate) {
        return;
      }
      lastVisibleAnchorRef.current = nextIsoDate;
      syncAnchor(nextIsoDate, "replace");
    },
    [anchorDayIso, syncAnchor],
  );

  return {
    goToDay,
    handlePrevDay,
    handleNextDay,
    handlePrevDayRange,
    handleNextDayRange,
    handleTodayClick,
    handleDayRangeChange,
    handleVisibleAnchorChange,
  };
}
