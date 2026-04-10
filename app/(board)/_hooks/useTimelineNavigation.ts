"use client";

import { useCallback } from "react";
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
}

const clampIndex = (index: number, length: number) => {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
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
}: UseTimelineNavigationProps) {
  const navStep = Math.max(1, dayRange);
  const fetchRange = Math.max(requestedFetchRange ?? dayRange, dayRange, 7);
  const currentTimelineIso = getCurrentTimelineIsoDateJst(timelineStartHour);

  const syncAnchor = useCallback(
    (nextIsoDate: string, method: UrlUpdateMethod = "replace") => {
      if (!nextIsoDate) return;
      setAnchorDayIso(nextIsoDate);
      const nextIndex = data?.days?.findIndex((day) => day.isoDate === nextIsoDate) ?? -1;
      if (nextIndex >= 0) {
        setActiveDayIndex(nextIndex);
      }
      updateUrlForTimeline({ date: nextIsoDate, method });
    },
    [data?.days, setActiveDayIndex, setAnchorDayIso, updateUrlForTimeline],
  );

  const navigateByDays = useCallback(
    async (delta: number, method: UrlUpdateMethod = "replace") => {
      if (!delta) return;

      const days = data?.days ?? [];
      const currentIndex = days.findIndex((day) => day.isoDate === anchorDayIso);
      const nextIndex = currentIndex >= 0 ? currentIndex + delta : activeDayIndex + delta;
      const cachedTarget = days[clampIndex(nextIndex, days.length)]?.isoDate ?? null;

      if (cachedTarget && nextIndex >= 0 && nextIndex < days.length) {
        syncAnchor(cachedTarget, method);
        return;
      }

      const targetOffset = getDayDiff(anchorDayIso, currentTimelineIso) + delta;
      const targetPayload = await fetchTimeline(targetOffset, { range: fetchRange, silent: true });
      const nextDays = targetPayload?.days ?? [];
      const nextIso =
        nextDays.find((day) => getDayDiff(day.isoDate, anchorDayIso) === delta)?.isoDate ??
        nextDays[clampIndex(Math.abs(delta), nextDays.length)]?.isoDate ??
        nextDays[0]?.isoDate;

      if (nextIso) {
        syncAnchor(nextIso, method);
      }
    },
    [
      activeDayIndex,
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
      await fetchTimeline(targetOffset, { range: fetchRange, silent: true });
      syncAnchor(targetIso, method);
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
      const currentDay = data?.days?.[activeDayIndex] ?? data?.days?.find((day) => day.isoDate === anchorDayIso);
      if (currentDay) {
        updateUrlForTimeline({ date: currentDay.isoDate });
      } else if (newRange > 0) {
        updateUrlForTimeline({ date: anchorDayIso });
      }
    },
    [activeDayIndex, anchorDayIso, data?.days, updateUrlForTimeline],
  );

  const handleVisibleAnchorChange = useCallback(
    (nextIsoDate: string) => {
      if (!nextIsoDate || nextIsoDate === anchorDayIso) return;
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
