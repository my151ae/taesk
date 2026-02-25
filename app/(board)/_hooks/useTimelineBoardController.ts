"use client";

import { useCallback, useMemo, useState } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";

type ListMonthDirection = -3 | -2 | -1 | 0 | 1 | 2 | 3;

type UseTimelineBoardControllerArgs = {
  searchParams: ReadonlyURLSearchParams;
  initialTimelineRange?: number | null;
  initialListRange?: number | null;
  urlDate: string | null;
  dataDays?: Array<{ isoDate: string }>;
  updateUrl: (date: string | null, range: number, time?: number | null) => void;
};

const todayJstIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export function useTimelineBoardController({
  searchParams,
  initialTimelineRange,
  initialListRange,
  urlDate,
  dataDays,
  updateUrl,
}: UseTimelineBoardControllerArgs) {
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
  const [calendarPreset, setCalendarPreset] = useState<"visible" | "this-week" | "next-week">("visible");
  const [timelineStartHour, setTimelineStartHour] = useState(5);

  const initialViewMode = useMemo(() => {
    const range = searchParams.get("range");
    return range && parseInt(range, 10) >= 30 ? "list" : "timeline";
  }, [searchParams]);

  const [viewMode, setViewMode] = useState<"timeline" | "list">(initialViewMode);
  const [timelineRange, setTimelineRange] = useState(initialTimelineRange || 2);
  const [listRange, setListRange] = useState(initialListRange || 30);
  const [listBaseDate, setListBaseDate] = useState<string>(() => todayJstIso());
  const [listBaseOffset, setListBaseOffset] = useState(0);
  const [listMonthDirection, setListMonthDirection] = useState<ListMonthDirection>(0);

  const intendedDayRange = useMemo(
    () => (viewMode === "timeline" ? timelineRange : listRange),
    [listRange, timelineRange, viewMode]
  );

  const effectiveDayRange = viewMode === "timeline" ? Math.min(intendedDayRange, 7) : intendedDayRange;

  const handleSetViewMode = useCallback(
    (mode: "timeline" | "list") => {
      setViewMode(mode);
      const targetRange = mode === "timeline" ? timelineRange : listRange;
      const currentDayIso =
        dataDays?.[activeDayIndex]?.isoDate || urlDate || new Date().toISOString().split("T")[0];
      updateUrl(currentDayIso, targetRange, null);
    },
    [activeDayIndex, dataDays, listRange, timelineRange, updateUrl, urlDate]
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
    calendarPreset,
    setCalendarPreset,
    timelineStartHour,
    setTimelineStartHour,
    viewMode,
    setViewMode,
    timelineRange,
    setTimelineRange,
    listRange,
    setListRange,
    listBaseDate,
    setListBaseDate,
    listBaseOffset,
    setListBaseOffset,
    listMonthDirection,
    setListMonthDirection,
    intendedDayRange,
    effectiveDayRange,
    handleSetViewMode,
  };
}
