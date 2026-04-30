"use client";

import { useCallback, useEffect, useRef } from "react";

import { getCurrentTimelineIsoDateJst, getDayDiff } from "@/app/(board)/_utils/timeline-helpers";
import { getMonthGridSpec, normalizeMonthAnchorDate } from "@/app/(board)/_components/timeline/month-view-helpers";
import {
  LIST_WINDOW_PRESETS,
  listWindowRange,
  type ListWindow,
} from "@/app/(board)/_hooks/useTimelineBoardController";
import type { ListWindowPresetKey } from "@/app/(board)/_hooks/useTimelineUrlState";
import type { TimelineResponse } from "@/app/(board)/_utils/timeline-helpers";

type TimelineUrlUpdateArgs = {
  date?: string | null;
};

type ListUrlUpdateArgs = {
};

type UseTimelineBoardModeSyncArgs = {
  viewMode: "timeline" | "list" | "month";
  handleSetViewMode: (mode: "timeline" | "list" | "month") => void;
  dataDays: TimelineResponse["days"] | undefined;
  dataStartOffset?: number;
  dataRange?: number;
  activeDayIndex: number;
  setActiveDayIndex: (index: number) => void;
  anchorDayIso: string;
  setAnchorDayIso: (isoDate: string) => void;
  resolvedDate: string | null;
  dayWindowStartRef: React.MutableRefObject<number>;
  setDayWindowStart: (offset: number) => void;
  status: string;
  fetchTimeline: (
    start?: number,
    options?: { silent?: boolean; range?: number },
  ) => Promise<TimelineResponse | null>;
  handleUpdateBoard: (updates: Record<string, unknown>) => void | Promise<void>;
  canPersistBoardPreferences: boolean;
  timelineStartHour: number;
  listAnchorDate: string;
  setListAnchorDate: (isoDate: string) => void;
  listAnchorOffset: number;
  setListAnchorOffset: (offset: number) => void;
  listWindow: ListWindow;
  setListWindow: (window: ListWindow) => void;
  setListWindowPresetKey: (preset: ListWindowPresetKey) => void;
  monthAnchorDate: string;
  setMonthAnchorDate: (isoDate: string) => void;
  updateUrlForTimeline: (args: TimelineUrlUpdateArgs) => void;
  updateUrlForList: (args: ListUrlUpdateArgs) => void;
  updateUrlForMonth: (args: { date?: string | null; method?: "replace" | "push" }) => void;
  timelineRange: number;
  suppressMonthUrlSyncRef: React.MutableRefObject<boolean>;
};

const addDaysToIsoDate = (baseIsoDate: string, delta: number) => {
  const d = new Date(`${baseIsoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

export function useTimelineBoardModeSync({
  viewMode,
  handleSetViewMode,
  dataDays,
  dataStartOffset,
  dataRange,
  activeDayIndex,
  setActiveDayIndex,
  anchorDayIso,
  setAnchorDayIso,
  resolvedDate,
  dayWindowStartRef,
  setDayWindowStart,
  status,
  fetchTimeline,
  handleUpdateBoard,
  canPersistBoardPreferences,
  timelineStartHour,
  listAnchorDate,
  setListAnchorDate,
  listAnchorOffset,
  setListAnchorOffset,
  listWindow,
  setListWindow,
  setListWindowPresetKey,
  monthAnchorDate,
  setMonthAnchorDate,
  updateUrlForTimeline,
  updateUrlForList,
  updateUrlForMonth,
  timelineRange,
  suppressMonthUrlSyncRef,
}: UseTimelineBoardModeSyncArgs) {
  const hasAppliedInitialListWindowRef = useRef(false);
  const hasAppliedInitialMonthWindowRef = useRef(false);
  const previousViewModeRef = useRef<"timeline" | "list" | "month">(viewMode);
  const pendingTimelineAnchorDateRef = useRef<string | null>(null);
  const pendingListWindowAutoSyncRef = useRef(false);
  const pendingListWindowAutoSyncAttemptsRef = useRef(0);

  const getListWindowSpec = useCallback((anchorOffset: number, window: ListWindow) => {
    const range = listWindowRange(window);
    return {
      range,
      startOffset: anchorOffset - window.before,
      anchorIndex: window.before,
    };
  }, []);

  const fetchListWindow = useCallback(
    async (anchorOffset: number, window: ListWindow) => {
      if (status === "loading") return;

      const { range, startOffset, anchorIndex } = getListWindowSpec(anchorOffset, window);

      setDayWindowStart(startOffset);
      dayWindowStartRef.current = startOffset;

      if (canPersistBoardPreferences) {
        void handleUpdateBoard({
          list_window_before_days: window.before,
          list_window_after_days: window.after,
          list_range: range,
        });
      }

      const payload = await fetchTimeline(startOffset, { range });
      const anchorDayIndex = Math.min(anchorIndex, Math.max((payload?.days?.length ?? 1) - 1, 0));
      const anchorDay = payload?.days?.[anchorDayIndex] ?? dataDays?.[0];

      if (anchorDay) {
        setListAnchorDate(anchorDay.isoDate);
        setListAnchorOffset(anchorOffset);
        updateUrlForList({});
      }

      setActiveDayIndex(anchorDayIndex);
    },
    [
      canPersistBoardPreferences,
      dataDays,
      dayWindowStartRef,
      fetchTimeline,
      getListWindowSpec,
      handleUpdateBoard,
      setActiveDayIndex,
      setDayWindowStart,
      setListAnchorDate,
      setListAnchorOffset,
      status,
      updateUrlForList,
    ],
  );

  const handleViewModeChange = useCallback(
    (mode: "timeline" | "list" | "month") => {
      if (mode === viewMode) return;

      const today = getCurrentTimelineIsoDateJst(timelineStartHour);
      const targetDate =
        anchorDayIso || dataDays?.[activeDayIndex]?.isoDate || listAnchorDate || resolvedDate || today;

      if (mode === "timeline") {
        const targetOffset = getDayDiff(targetDate, today);
        setDayWindowStart(targetOffset);
        dayWindowStartRef.current = targetOffset;
        setAnchorDayIso(targetDate);
        pendingTimelineAnchorDateRef.current = targetDate;
        pendingListWindowAutoSyncRef.current = false;
        pendingListWindowAutoSyncAttemptsRef.current = 0;
      } else if (mode === "month") {
        const nextMonthAnchor = normalizeMonthAnchorDate(targetDate);
        const monthGrid = getMonthGridSpec(nextMonthAnchor);
        const startOffset = getDayDiff(monthGrid.gridStartIso, today);
        setDayWindowStart(startOffset);
        dayWindowStartRef.current = startOffset;
        setMonthAnchorDate(nextMonthAnchor);
        pendingTimelineAnchorDateRef.current = null;
        pendingListWindowAutoSyncRef.current = false;
        pendingListWindowAutoSyncAttemptsRef.current = 0;
      } else {
        const anchorOffset = getDayDiff(targetDate, today);
        const startOffset = anchorOffset - listWindow.before;
        setDayWindowStart(startOffset);
        dayWindowStartRef.current = startOffset;
        pendingTimelineAnchorDateRef.current = null;
        pendingListWindowAutoSyncRef.current = true;
        pendingListWindowAutoSyncAttemptsRef.current = 0;
        setListAnchorOffset(anchorOffset);
        setListAnchorDate(targetDate);
        setActiveDayIndex(Math.max(0, listWindow.before));
      }

      handleSetViewMode(mode);
    },
    [
      activeDayIndex,
      anchorDayIso,
      dataDays,
      dayWindowStartRef,
      handleSetViewMode,
      listAnchorDate,
      listWindow.before,
      resolvedDate,
      setActiveDayIndex,
      setAnchorDayIso,
      setDayWindowStart,
      setListAnchorDate,
      setListAnchorOffset,
      setMonthAnchorDate,
      viewMode,
      timelineStartHour,
    ],
  );

  const shiftListWindow = useCallback(
    (delta: number) => {
      const nextAnchorOffset = listAnchorOffset + delta;
      const nextAnchorDate = addDaysToIsoDate(
        listAnchorDate || getCurrentTimelineIsoDateJst(timelineStartHour),
        delta,
      );
      setListAnchorOffset(nextAnchorOffset);
      setListAnchorDate(nextAnchorDate);
      void fetchListWindow(nextAnchorOffset, listWindow);
    },
    [
      fetchListWindow,
      listAnchorDate,
      listAnchorOffset,
      listWindow,
      setListAnchorDate,
      setListAnchorOffset,
      timelineStartHour,
    ],
  );

  const handleListPrevDay = useCallback(() => {
    shiftListWindow(-1);
  }, [shiftListWindow]);

  const handleListNextDay = useCallback(() => {
    shiftListWindow(1);
  }, [shiftListWindow]);

  const handleListPrevWeek = useCallback(() => {
    shiftListWindow(-7);
  }, [shiftListWindow]);

  const handleListNextWeek = useCallback(() => {
    shiftListWindow(7);
  }, [shiftListWindow]);

  const handleListToday = useCallback(() => {
    const today = getCurrentTimelineIsoDateJst(timelineStartHour);
    setListAnchorOffset(0);
    setListAnchorDate(today);
    void fetchListWindow(0, listWindow);
  }, [fetchListWindow, listWindow, setListAnchorDate, setListAnchorOffset, timelineStartHour]);

  const handleListWindowPresetChange = useCallback(
    (nextPreset: ListWindowPresetKey) => {
      const nextWindow = LIST_WINDOW_PRESETS[nextPreset];
      setListWindowPresetKey(nextPreset);
      setListWindow(nextWindow);
      void fetchListWindow(listAnchorOffset, nextWindow);
    },
    [fetchListWindow, listAnchorOffset, setListWindow, setListWindowPresetKey],
  );

  const handleListBaseDateChange = useCallback(
    (nextIsoDate: string) => {
      if (!nextIsoDate) return;
      const nextAnchorOffset = getDayDiff(nextIsoDate, getCurrentTimelineIsoDateJst(timelineStartHour));
      setListAnchorOffset(nextAnchorOffset);
      setListAnchorDate(nextIsoDate);
      void fetchListWindow(nextAnchorOffset, listWindow);
    },
    [fetchListWindow, listWindow, setListAnchorDate, setListAnchorOffset, timelineStartHour],
  );

  useEffect(() => {
    if (viewMode !== "timeline") return;

    const today = getCurrentTimelineIsoDateJst(timelineStartHour);
    const targetAnchorDate = anchorDayIso || resolvedDate || today;
    const startOffset = getDayDiff(targetAnchorDate, today);

    if (status === "loading") return;

    if (dataStartOffset === startOffset && dataRange === timelineRange) {
      previousViewModeRef.current = "timeline";
      return;
    }

    setDayWindowStart(startOffset);
    dayWindowStartRef.current = startOffset;
    pendingTimelineAnchorDateRef.current = targetAnchorDate;
    void fetchTimeline(startOffset, { range: timelineRange });
    previousViewModeRef.current = "timeline";
  }, [
    anchorDayIso,
    dataRange,
    dataStartOffset,
    dayWindowStartRef,
    fetchTimeline,
    resolvedDate,
    setDayWindowStart,
    status,
    timelineRange,
    timelineStartHour,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode !== "month") {
      suppressMonthUrlSyncRef.current = false;
      hasAppliedInitialMonthWindowRef.current = false;
      return;
    }

    const today = getCurrentTimelineIsoDateJst(timelineStartHour);
    const normalizedMonthAnchor = normalizeMonthAnchorDate(monthAnchorDate || today);
    const monthGrid = getMonthGridSpec(normalizedMonthAnchor);
    const startOffset = getDayDiff(monthGrid.gridStartIso, today);

    if (status === "loading") return;

    if (dataStartOffset === startOffset && dataRange === monthGrid.range) {
      hasAppliedInitialMonthWindowRef.current = true;
      previousViewModeRef.current = "month";
      if (!suppressMonthUrlSyncRef.current) {
        updateUrlForMonth({
          date: normalizedMonthAnchor,
          method: "replace",
        });
      }
      return;
    }

    hasAppliedInitialMonthWindowRef.current = true;
    if (normalizedMonthAnchor !== monthAnchorDate) {
      setMonthAnchorDate(normalizedMonthAnchor);
    }
    setDayWindowStart(startOffset);
    dayWindowStartRef.current = startOffset;
    void fetchTimeline(startOffset, { range: monthGrid.range });
    previousViewModeRef.current = "month";
  }, [
    dataRange,
    dataStartOffset,
    dayWindowStartRef,
    fetchTimeline,
    monthAnchorDate,
    setDayWindowStart,
    setMonthAnchorDate,
    status,
    suppressMonthUrlSyncRef,
    timelineStartHour,
    updateUrlForMonth,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode !== "timeline") return;

    const pendingAnchorDate = pendingTimelineAnchorDateRef.current;
    if (!pendingAnchorDate) return;
    if (dataDays?.[0]?.isoDate !== pendingAnchorDate) return;

    setActiveDayIndex(0);
    pendingTimelineAnchorDateRef.current = null;
  }, [dataDays, setActiveDayIndex, viewMode]);

  useEffect(() => {
    if (viewMode !== "list") {
      if (viewMode === "timeline" || viewMode === "month") {
        previousViewModeRef.current = viewMode;
      }
      return;
    }

    const isInitialListOpen = !hasAppliedInitialListWindowRef.current;
    const switchedFromTimeline = previousViewModeRef.current === "timeline";
    if (!isInitialListOpen && !switchedFromTimeline) {
      previousViewModeRef.current = "list";
      return;
    }

    const { range, startOffset, anchorIndex } = getListWindowSpec(listAnchorOffset, listWindow);

    if (pendingListWindowAutoSyncRef.current) {
      if (dataStartOffset === startOffset && dataRange === range) {
        pendingListWindowAutoSyncRef.current = false;
        pendingListWindowAutoSyncAttemptsRef.current = 0;
      } else if (status === "loading") {
        return;
      } else if (pendingListWindowAutoSyncAttemptsRef.current === 0) {
        pendingListWindowAutoSyncAttemptsRef.current = 1;
        return;
      } else {
        pendingListWindowAutoSyncRef.current = false;
        pendingListWindowAutoSyncAttemptsRef.current = 0;
      }
    }

    if (status === "loading") return;

    if (dataStartOffset === startOffset && dataRange === range) {
      const nextAnchorIndex = Math.min(anchorIndex, Math.max((dataDays?.length ?? 1) - 1, 0));
      const anchorDay = dataDays?.[nextAnchorIndex];
      if (anchorDay) {
        setListAnchorDate(anchorDay.isoDate);
        setListAnchorOffset(getDayDiff(anchorDay.isoDate, getCurrentTimelineIsoDateJst(timelineStartHour)));
        updateUrlForList({});
      }
      setActiveDayIndex(nextAnchorIndex);
      hasAppliedInitialListWindowRef.current = true;
      previousViewModeRef.current = "list";
      return;
    }

    hasAppliedInitialListWindowRef.current = true;
    void fetchListWindow(listAnchorOffset, listWindow);
    previousViewModeRef.current = "list";
  }, [
    dataDays,
    dataRange,
    dataStartOffset,
    fetchListWindow,
    getListWindowSpec,
    listAnchorOffset,
    listWindow,
    setActiveDayIndex,
    setListAnchorDate,
    setListAnchorOffset,
    status,
    timelineStartHour,
    updateUrlForList,
    viewMode,
  ]);

  return {
    handleViewModeChange,
    handleListPrevDay,
    handleListNextDay,
    handleListPrevWeek,
    handleListNextWeek,
    handleListToday,
    handleListBaseDateChange,
    handleListWindowPresetChange,
  };
}
