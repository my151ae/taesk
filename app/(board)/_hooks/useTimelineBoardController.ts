"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentTimelineIsoDateJst, getDayDiff } from "@/app/(board)/_utils/timeline-helpers";
import type {
  ListWindow,
  ListWindowPresetKey,
  ResolvedTimelineUrlState,
  UrlUpdateMethod,
} from "@/app/(board)/_hooks/useTimelineUrlState";
export type { ListWindow };

type TimelineUrlUpdateArgs = {
  date?: string | null;
  range: number;
  time?: number | null;
  method?: UrlUpdateMethod;
  card?: string | null;
};

type ListUrlUpdateArgs = {
  date?: string | null;
  before: number;
  after: number;
  time?: number | null;
  method?: UrlUpdateMethod;
  card?: string | null;
};

type UseTimelineBoardControllerArgs = {
  initialTimelineRange?: number | null;
  resolvedState: ResolvedTimelineUrlState;
  dataDays?: Array<{ isoDate: string }>;
  updateUrlForTimeline: (args: TimelineUrlUpdateArgs) => void;
  updateUrlForList: (args: ListUrlUpdateArgs) => void;
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
  initialTimelineRange,
  resolvedState,
  dataDays,
  updateUrlForTimeline,
  updateUrlForList,
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
  const [viewMode, setViewMode] = useState<"timeline" | "list">(resolvedState.view);
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

    setViewMode(resolvedState.view);
    setTimelineRange(nextTimelineRange);
    setAnchorDayIso(resolvedState.date ?? getCurrentTimelineIsoDateJst(timelineStartHour));
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

  const intendedDayRange = useMemo(
    () => (viewMode === "timeline" ? timelineRange : listRange),
    [listRange, timelineRange, viewMode]
  );

  const effectiveDayRange = viewMode === "timeline" ? Math.min(intendedDayRange, 7) : intendedDayRange;

  const handleSetViewMode = useCallback(
    (mode: "timeline" | "list") => {
      setViewMode(mode);
      const today = getCurrentTimelineIsoDateJst(timelineStartHour);
      const currentDayIso = anchorDayIso || dataDays?.[activeDayIndex]?.isoDate || listAnchorDate || resolvedState.date || today;

      if (mode === "timeline") {
        updateUrlForTimeline({
          date: currentDayIso,
          range: timelineRange,
          time: null,
        });
        return;
      }

      const nextAnchorOffset = getDayDiff(currentDayIso, today);
      setListAnchorOffset(nextAnchorOffset);
      setListAnchorDate(currentDayIso);
      updateUrlForList({
        date: currentDayIso,
        before: listWindow.before,
        after: listWindow.after,
        time: null,
      });
    },
    [
      activeDayIndex,
      anchorDayIso,
      dataDays,
      listAnchorDate,
      listWindow.after,
      listWindow.before,
      resolvedState.date,
      timelineRange,
      timelineStartHour,
      updateUrlForList,
      updateUrlForTimeline,
    ]
  );

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
    listRange,
    intendedDayRange,
    effectiveDayRange,
    handleSetViewMode,
  };
}
