"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentTimelineIsoDateJst, getDayDiff } from "@/app/(board)/_utils/timeline-helpers";
import {
  getMonthGridSpec,
  normalizeMonthAnchorDate,
} from "@/app/(board)/_components/timeline/month-view-helpers";
import type {
  ListWindow,
  ListWindowPresetKey,
  ResolvedTimelineUrlState,
  TimelineViewMode,
  UrlUpdateMethod,
} from "@/app/(board)/_hooks/useTimelineUrlState";
export type { ListWindow };

type TimelineUrlUpdateArgs = {
  date?: string | null;
  method?: UrlUpdateMethod;
  card?: string | null;
};

type ListUrlUpdateArgs = {
  method?: UrlUpdateMethod;
  card?: string | null;
};

type UseTimelineBoardControllerArgs = {
  boardId?: string | null;
  initialTimelineRange?: number | null;
  resolvedState: ResolvedTimelineUrlState;
  dataDays?: Array<{ isoDate: string }>;
  updateUrlForTimeline: (args: TimelineUrlUpdateArgs) => void;
  updateUrlForList: (args: ListUrlUpdateArgs) => void;
  updateUrlForMonth: (args: { date?: string | null; method?: UrlUpdateMethod; card?: string | null }) => void;
};

const clampTimelineRange = (range: number) => Math.max(1, Math.min(7, Math.round(range)));

const normalizeListWindow = (window: ListWindow): ListWindow => {
  const before = Math.max(0, Math.round(window.before));
  const after = Math.max(0, Math.round(window.after));
  if (before + after + 1 > 120) {
    return { before: 15, after: 15 };
  }
  return { before, after };
};

export const LIST_WINDOW_PRESETS: Record<ListWindowPresetKey, ListWindow> = {
  plus3: { before: 0, after: 89 },
  plus2: { before: 0, after: 59 },
  plus1: { before: 0, after: 29 },
  zero: { before: 15, after: 15 },
  minus1: { before: 29, after: 0 },
  minus2: { before: 59, after: 0 },
  minus3: { before: 89, after: 0 },
};

const PRESET_ORDER: ListWindowPresetKey[] = ["plus3", "plus2", "plus1", "zero", "minus1", "minus2", "minus3"];

export const getPresetLabel = (preset: ListWindowPresetKey) => {
  switch (preset) {
    case "plus3":
      return "+3 mo.";
    case "plus2":
      return "+2 mo.";
    case "plus1":
      return "+1 mo.";
    case "zero":
      return "0 mo.";
    case "minus1":
      return "-1 mo.";
    case "minus2":
      return "-2 mo.";
    case "minus3":
      return "-3 mo.";
    default:
      return "0 mo.";
  }
};

export const listWindowRange = (window: ListWindow) => window.before + window.after + 1;

export const derivePresetFromWindow = (window: ListWindow): ListWindowPresetKey => {
  const target = normalizeListWindow(window);
  for (const preset of PRESET_ORDER) {
    const candidate = LIST_WINDOW_PRESETS[preset];
    if (candidate.before === target.before && candidate.after === target.after) {
      return preset;
    }
  }
  if (target.before > 0 && target.after === 0) {
    if (target.before >= 89) return "minus3";
    if (target.before >= 59) return "minus2";
    return "minus1";
  }
  if (target.before === 0 && target.after > 0) {
    if (target.after >= 89) return "plus3";
    if (target.after >= 59) return "plus2";
    return "plus1";
  }
  return "zero";
};

export function useTimelineBoardController({
  boardId,
  initialTimelineRange,
  resolvedState,
  dataDays,
  updateUrlForTimeline,
  updateUrlForList,
  updateUrlForMonth,
}: UseTimelineBoardControllerArgs) {
  const initialTimelineIsoDate = resolvedState.date ?? getCurrentTimelineIsoDateJst(5);
  const [showBoardMenu, setShowBoardMenu] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [showBoardSettings, setShowBoardSettings] = useState(false);
  const [boardSettingsBoardId, setBoardSettingsBoardId] = useState<string | null>(null);
  const [showTeamSettings, setShowTeamSettings] = useState(false);
  const [teamSettingsTeamId, setTeamSettingsTeamId] = useState<string | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [anchorDayIso, setAnchorDayIso] = useState<string>(initialTimelineIsoDate);
  const [calendarPreset, setCalendarPreset] = useState<"visible" | "this-week" | "next-week">("visible");
  const [timelineStartHour, setTimelineStartHour] = useState(5);

  const initialWindow = normalizeListWindow(resolvedState.listWindow);
  const [viewMode, setViewMode] = useState<TimelineViewMode>(resolvedState.view);
  const [timelineRange, setTimelineRange] = useState(
    clampTimelineRange(resolvedState.timelineRange || initialTimelineRange || 2)
  );
  const [listWindow, setListWindow] = useState<ListWindow>(initialWindow);
  const [listWindowPresetKey, setListWindowPresetKey] = useState<ListWindowPresetKey>(
    derivePresetFromWindow(initialWindow)
  );
  const [listAnchorDate, setListAnchorDate] = useState<string>(
    resolvedState.date ?? getCurrentTimelineIsoDateJst(timelineStartHour)
  );
  const [listAnchorOffset, setListAnchorOffset] = useState<number>(resolvedState.anchorOffset);
  const [monthAnchorDate, setMonthAnchorDate] = useState<string>(
    resolvedState.view === "month"
      ? normalizeMonthAnchorDate(resolvedState.date ?? getCurrentTimelineIsoDateJst(timelineStartHour))
      : normalizeMonthAnchorDate(getCurrentTimelineIsoDateJst(timelineStartHour))
  );
  const previousBoardIdRef = useRef(boardId ?? null);

  useEffect(() => {
    const nextTimelineRange = clampTimelineRange(
      resolvedState.view === "timeline"
        ? resolvedState.timelineRange
        : initialTimelineRange || resolvedState.timelineRange || 2
    );
    const nextListWindow = normalizeListWindow({
      before: resolvedState.listWindow.before,
      after: resolvedState.listWindow.after,
    });
    const boardChanged = previousBoardIdRef.current !== (boardId ?? null);
    previousBoardIdRef.current = boardId ?? null;

    setViewMode(resolvedState.view);
    if (boardChanged) {
      setTimelineRange(nextTimelineRange);
    }
    setAnchorDayIso(resolvedState.date ?? getCurrentTimelineIsoDateJst(timelineStartHour));
    if (resolvedState.view === "month") {
      setMonthAnchorDate(normalizeMonthAnchorDate(resolvedState.date ?? getCurrentTimelineIsoDateJst(timelineStartHour)));
    }
    setListWindow(nextListWindow);
    setListWindowPresetKey(derivePresetFromWindow(nextListWindow));
    setActiveDayIndex(
      resolvedState.view === "timeline"
        ? 0
        : Math.max(0, Math.min(nextListWindow.before, nextListWindow.before + nextListWindow.after))
    );
    if (resolvedState.view === "list" && resolvedState.date) {
      setListAnchorDate(resolvedState.date);
    }
    if (resolvedState.view === "list") {
      setListAnchorOffset(resolvedState.anchorOffset);
    }
  }, [
    boardId,
    initialTimelineRange,
    resolvedState.view,
    resolvedState.timelineRange,
    resolvedState.listWindow.before,
    resolvedState.listWindow.after,
    resolvedState.date,
    resolvedState.anchorOffset,
    timelineStartHour,
  ]);

  const listRange = useMemo(() => listWindowRange(listWindow), [listWindow]);
  const monthGrid = useMemo(() => getMonthGridSpec(monthAnchorDate), [monthAnchorDate]);

  const intendedDayRange = useMemo(
    () => (viewMode === "timeline" ? timelineRange : viewMode === "list" ? listRange : monthGrid.range),
    [listRange, monthGrid.range, timelineRange, viewMode]
  );

  const effectiveDayRange = viewMode === "timeline" ? Math.min(intendedDayRange, 7) : intendedDayRange;

  const handleSetViewMode = useCallback(
    (mode: TimelineViewMode) => {
      setViewMode(mode);
      const today = getCurrentTimelineIsoDateJst(timelineStartHour);
      const currentDayIso =
        mode === "timeline" && viewMode === "month"
          ? monthAnchorDate || resolvedState.date || today
          : anchorDayIso || dataDays?.[activeDayIndex]?.isoDate || monthAnchorDate || listAnchorDate || resolvedState.date || today;

      if (mode === "timeline") {
        updateUrlForTimeline({
          date: currentDayIso,
        });
        return;
      }

      if (mode === "month") {
        const nextMonthAnchor = normalizeMonthAnchorDate(currentDayIso);
        setMonthAnchorDate(nextMonthAnchor);
        updateUrlForMonth({
          date: nextMonthAnchor,
          method: "replace",
        });
        return;
      }

      const nextAnchorOffset = getDayDiff(currentDayIso, today);
      setListAnchorOffset(nextAnchorOffset);
      setListAnchorDate(currentDayIso);
      updateUrlForList({});
    },
    [
      activeDayIndex,
      anchorDayIso,
      dataDays,
      listAnchorDate,
      listWindow.after,
      listWindow.before,
      resolvedState.date,
      monthAnchorDate,
      timelineRange,
      timelineStartHour,
      updateUrlForList,
      updateUrlForMonth,
      updateUrlForTimeline,
      viewMode,
    ]
  );

  const shiftMonth = useCallback(
    (delta: number) => {
      const base = monthAnchorDate || getCurrentTimelineIsoDateJst(timelineStartHour);
      const date = new Date(`${base}T00:00:00Z`);
      const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1))
        .toISOString()
        .slice(0, 10);
      setMonthAnchorDate(next);
      if (viewMode === "month") {
        updateUrlForMonth({ date: next, method: "push" });
      }
    },
    [monthAnchorDate, timelineStartHour, updateUrlForMonth, viewMode],
  );

  const handleMonthPrev = useCallback(() => {
    shiftMonth(-1);
  }, [shiftMonth]);

  const handleMonthNext = useCallback(() => {
    shiftMonth(1);
  }, [shiftMonth]);

  const handleMonthToday = useCallback(() => {
    const today = normalizeMonthAnchorDate(getCurrentTimelineIsoDateJst(timelineStartHour));
    setMonthAnchorDate(today);
    if (viewMode === "month") {
      updateUrlForMonth({ date: today, method: "push" });
    }
  }, [timelineStartHour, updateUrlForMonth, viewMode]);

  return {
    showBoardMenu,
    setShowBoardMenu,
    showShareDialog,
    setShowShareDialog,
    showNotificationSettings,
    setShowNotificationSettings,
    showProfileSettings,
    setShowProfileSettings,
    showBoardSettings,
    setShowBoardSettings,
    boardSettingsBoardId,
    setBoardSettingsBoardId,
    showTeamSettings,
    setShowTeamSettings,
    teamSettingsTeamId,
    setTeamSettingsTeamId,
    showShortcutsModal,
    setShowShortcutsModal,
    activeDayIndex,
    setActiveDayIndex,
    anchorDayIso,
    setAnchorDayIso,
    calendarPreset,
    setCalendarPreset,
    timelineStartHour,
    setTimelineStartHour,
    viewMode,
    setViewMode,
    timelineRange,
    setTimelineRange,
    listWindow,
    setListWindow,
    listWindowPresetKey,
    setListWindowPresetKey,
    listAnchorDate,
    setListAnchorDate,
    listAnchorOffset,
    setListAnchorOffset,
    monthAnchorDate,
    setMonthAnchorDate,
    monthGrid,
    listRange,
    intendedDayRange,
    effectiveDayRange,
    handleSetViewMode,
    handleMonthPrev,
    handleMonthNext,
    handleMonthToday,
  };
}
