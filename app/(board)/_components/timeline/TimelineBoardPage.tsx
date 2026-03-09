"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Board } from "@/lib/supabase";
import { buildBoardUrl } from "@/lib/board-url";

import { CardModal } from "@/app/components/CardModal";
import { useAuth } from "@/app/contexts/AuthContext";
import TimelineBoardHeader from "@/app/(board)/_components/timeline/TimelineBoardHeader";
import TimelineBoardDialogs from "@/app/(board)/_components/timeline/TimelineBoardDialogs";
import { DesktopTimelineView } from "@/app/(board)/_components/timeline/DesktopTimelineView";
import MobileTimelineView from "@/app/(board)/_components/timeline/MobileTimelineView";
import { CardContextMenu } from "@/app/(board)/_components/timeline/CardContextMenu";
import { ShortcutsModal } from "@/app/(board)/_components/timeline/ShortcutsModal";
import {
  type TimelineEvent,
  minuteToPixels,
  getNowMinutesJst,
  getDayDiff,
  DEFAULT_TIMELINE_DAY_RANGE,
} from "@/app/(board)/_utils/timeline-helpers";
import { buildMockTimeline } from "@/app/(board)/_utils/timeline-board-helpers";
import { DesktopListView } from "@/app/(board)/_components/timeline/DesktopListView";
import MobileListView from "@/app/(board)/_components/timeline/MobileListView";

import { useTimelineCalendar } from "@/app/(board)/_hooks/useTimelineCalendar";
import { useCardModal } from "@/app/(board)/_hooks/useCardModal";
import { useTimelineUrlState } from "@/app/(board)/_hooks/useTimelineUrlState";
import { useTimelineScrollSync } from "@/app/(board)/_hooks/useTimelineScrollSync";
import { useTimelineData } from "@/app/(board)/_hooks/useTimelineData";
import { useTimelineDragAndDrop } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import { useTimelineZoomStore } from "@/app/(board)/_stores/timeline-zoom-store"; // [NEW]

// New hooks
import { useTimelineViewport } from "@/app/(board)/_hooks/useTimelineViewport";
import { useTimelineFiltering } from "@/app/(board)/_hooks/useTimelineFiltering";
import { useTimelineNavigation } from "@/app/(board)/_hooks/useTimelineNavigation";
import { useTimelineCardActions } from "@/app/(board)/_hooks/useTimelineCardActions";
import { useTimelineContextMenu } from "@/app/(board)/_hooks/useTimelineContextMenu";
import { useSpatialArrowFocus } from "@/app/(board)/_hooks/useSpatialArrowFocus";
import { useTimelineCardContextMenuItems } from "@/app/(board)/_hooks/useTimelineCardContextMenuItems";
import { useTimelineBoardInitialization } from "@/app/(board)/_hooks/useTimelineBoardInitialization";
import { useTimelineBoardViewModels } from "@/app/(board)/_hooks/useTimelineBoardViewModels";
import {
  LIST_WINDOW_PRESETS,
  listWindowRange,
  useTimelineBoardController,
  type ListWindow,
} from "@/app/(board)/_hooks/useTimelineBoardController";
import type { ListWindowPresetKey } from "@/app/(board)/_hooks/useTimelineUrlState";

type TimelineBoardPageProps = {
  initialBoard: Board;
};

const DAY_WINDOW_RANGE = DEFAULT_TIMELINE_DAY_RANGE;
const buildMockTimelineResponse = () => buildMockTimeline(DAY_WINDOW_RANGE);
const todayJstIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const deriveListWindowFromRange = (range?: number | null): ListWindow => {
  const normalized = typeof range === "number" ? Math.max(1, Math.round(range)) : 30;
  if (normalized === 31) return { before: 15, after: 15 };
  if (normalized >= 90) return { before: 0, after: 89 };
  if (normalized >= 60) return { before: 0, after: 59 };
  return { before: 0, after: 29 };
};

const addDaysToIsoDate = (baseIsoDate: string, delta: number) => {
  const d = new Date(`${baseIsoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

export default function TimelineBoardPage({ initialBoard }: TimelineBoardPageProps) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const boardMenuRef = useRef<HTMLDivElement | null>(null);

  const hourHeight = useTimelineZoomStore((state) => state.hourHeight); // [NEW]

  const focusCardById = useCallback((cardId: string | null) => {
    if (!cardId) return;
    const target = document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null;
    if (target) {
      target.focus();
    }
  }, []);

  const {
    contextMenu,
    handleCardContextMenu,
    handleCardContextMenuByKeyboard,
    closeContextMenu,
  } = useTimelineContextMenu({ focusCardById });

  // 1. URL State
  const basePath = buildBoardUrl(initialBoard) || (typeof window !== "undefined" ? window.location.pathname : `/b/${initialBoard.short_id ?? ""}`);
  const defaultListWindow = {
    before: initialBoard.list_window_before_days ?? deriveListWindowFromRange(initialBoard.list_range).before,
    after: initialBoard.list_window_after_days ?? deriveListWindowFromRange(initialBoard.list_range).after,
  };
  const {
    parseResult,
    resolvedState,
    dayWindowStartRef,
    setDayWindowStart,
    updateUrlForTimeline,
    updateUrlForList,
    setCard,
  } = useTimelineUrlState({
    basePath,
    defaultTimelineRange: initialBoard.day_range,
    defaultListBefore: defaultListWindow.before,
    defaultListAfter: defaultListWindow.after,
    defaultView: "timeline",
  });

  const {
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
  } = useTimelineBoardController({
    initialTimelineRange: initialBoard.day_range,
    resolvedState,
    updateUrlForTimeline,
    updateUrlForList,
  });

  const hasAppliedInitialListWindowRef = useRef(false);
  const previousViewModeRef = useRef<"timeline" | "list">(viewMode);
  const pendingTimelineAnchorDateRef = useRef<string | null>(null);
  const pendingListWindowAutoSyncRef = useRef(false);
  const pendingListWindowAutoSyncAttemptsRef = useRef(0);

  const {
    boardMembers,
    profile,
    availableBoards,
    availableTeams,
    setAvailableBoards,
    fetchProfile,
    refreshBoardMembers,
    handleBoardNavigate: navigateBoard,
    handleUpdateBoard,
    currentBoard,
  } = useTimelineBoardInitialization({
    initialBoard,
    currentBoardId: initialBoard.id,
    userId: user?.id,
    router,
    onTimelineStartHour: setTimelineStartHour,
  });

  // 2. Data Fetching
  const {
    data,
    setData,
    status,
    setErrorMessage,
    dataMode,
    fetchTimeline,
    realtimeStatus,
  } = useTimelineData({
    initialBoard,
    dayRange: intendedDayRange, // Use intended range instead of dayRange from URL
    dayWindowStartRef,
    setDayWindowStart,
    buildMockTimelineResponse,
  });

  // 3. Card Modal State
  const {
    modalCard,
    cardModalStatus,
    cardModalError,
    setCardModalError,
    setModalCardOverride,
    openCardModal,
    closeCardModal,
    modalProfiles,
  } = useCardModal({
    initialBoard,
    dataMode,
    data,
    setCardInUrl: setCard,
  });

  // 4. Viewport & Timing
  const timelineHeaderRef = useRef<HTMLDivElement | null>(null);
  const {
    timelineHeaderHeight,
    timelineViewportHeight,
    liveNowMinutes,
    liveNowIsoDate,
  } = useTimelineViewport({ timelineHeaderRef, serverNow: data?.serverNow, hourHeight }); // [NEW]

  // 5. Filtering
  const {
    searchQuery, setSearchQuery,
    selectedTags, setSelectedTags,
    sortBy, setSortBy,
    showFilters, setShowFilters,
    filteredData,
    hasActiveFilters,
    availableTags,
  } = useTimelineFiltering(data);

  // 6. Navigation
  const abScrollContainersRef = useRef<Record<string, HTMLDivElement | null>>({});
  const desktopTimelineScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileTimelineScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useMemo(
    () =>
      ({
        get current() {
          return desktopTimelineScrollRef.current || mobileTimelineScrollRef.current;
        },
      } as React.RefObject<HTMLDivElement>),
    []
  );

  const {
    handlePrevDay,
    handleNextDay,
    handleTodayClick,
    handleDayRangeChange,
  } = useTimelineNavigation({
    data, status, dayRange: timelineRange, activeDayIndex, setActiveDayIndex,
    fetchTimeline, updateUrlForTimeline, timelineScrollRef, dayWindowStartRef,
    hourHeight // [NEW]
  });

  // 7. Calendar
  const visibleDays = useMemo(() => {
    const days = data?.days ?? [];
    if (!days.length) return [];
    return days.slice(activeDayIndex, activeDayIndex + effectiveDayRange);
  }, [activeDayIndex, data?.days, effectiveDayRange]);

  const {
    calendarEventsByDay,
    calendarAllDayEventsByDay,
    googleCalendarEvents,
    googleCalendarStatus,
    googleCalendarError,
    refreshGoogleCalendar,
  } = useTimelineCalendar({
    calendarPreset,
    calendarRangeStart: visibleDays[0] ? new Date(visibleDays[0].isoDate) : null,
    calendarRangeEnd: visibleDays[visibleDays.length - 1] ? new Date(visibleDays[visibleDays.length - 1].isoDate) : null,
    days: data?.days ?? [],
  });

  const googleCalendarLabel = useMemo(() => {
    if (!googleCalendarEvents?.length) return "primary";
    const ids = new Set<string>();
    googleCalendarEvents.forEach((event) => {
      if (event?.calendarId) ids.add(event.calendarId);
    });
    if (!ids.size) return "primary";
    return Array.from(ids).sort().join(", ");
  }, [googleCalendarEvents]);

  const googleStatusText = useMemo(() => {
    if (googleCalendarStatus === "loading") return "Google予定同期中...";
    if (googleCalendarStatus === "success") return `Google予定表示中 (${googleCalendarLabel})`;
    if (googleCalendarStatus === "disconnected") return "Google未接続";
    if (googleCalendarStatus === "error") return "Google予定の取得エラー";
    return "Google予定の状態確認中...";
  }, [googleCalendarLabel, googleCalendarStatus]);

  // 8. Card Actions & External Sync
  const bucketDayMap = useMemo(() => {
    const result: Record<string, string | null> = {};
    data?.days?.forEach((day) => {
      result[`${day.key}_a`] = day.isoDate;
      result[`${day.key}_b`] = day.isoDate;
    });
    return result;
  }, [data?.days]);


  const {
    applyPatch,
    handleCardModalSave,
    handleCardModalDelete,
    handleToggleCardChecked,
    handleColumnClick,
    handleBucketClick,
    handleExternalEventClick,
    moveCardByDayOffset,
    googleToast,
    setGoogleToast,
    historySaveWarning,
    retryHistorySave,
    closeModalWithoutHistory,
  } = useTimelineCardActions({
    initialBoardId: currentBoard.id,
    dataMode, setData, fetchTimeline, openCardModal, closeCardModal,
    modalCard, setModalCardOverride, setCardModalError, setErrorMessage,
    bucketDayMap, refreshGoogleCalendar, data,
  });

  const handleGoogleConnect = useCallback(() => {
    if (typeof window === "undefined") return;
    window.location.href = "/api/integrations/google-calendar/connect";
  }, []);

  // 9. Drag and Drop
  const {
    sensors, activeDrag, pointerPreview, activeResize, bucketIndicator, isOverABList,
    handleDragStart, handleDragMove, handleDragEnd, handleDragCancel,
    handleEventKeyDown, handleResizeStart, handleResizeMove, handleResizeEnd,
  } = useTimelineDragAndDrop({
    data: filteredData, setData, applyPatch, timelineScrollRef,
    abScrollContainersRef, bucketDayMap, dataMode,
    timelineStartHour,
    hourHeight, // [NEW]
  });

  // 10. Scroll Sync
  const indicatorMinutes = liveNowMinutes ?? (data ? getNowMinutesJst(data.serverNow) : null);
  const indicatorTop = indicatorMinutes != null ? minuteToPixels(indicatorMinutes, timelineStartHour, hourHeight) : null; // [NEW]

  const {
    debouncedHandleScroll,
    handleTimelineViewMount,
  } = useTimelineScrollSync({
    viewMode,
    urlDate: resolvedState.view === "timeline" ? resolvedState.date : null,
    urlRange: resolvedState.view === "timeline" ? resolvedState.timelineRange : null,
    urlTime: resolvedState.view === "timeline" ? resolvedState.time : null,
    data,
    activeDayIndex,
    dayRange: timelineRange,
    indicatorMinutes,
    updateUrlForTimeline,
    timelineStartHour,
    hourHeight, // [NEW]
  });

  // Click outside board menu
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (boardMenuRef.current && !boardMenuRef.current.contains(e.target as Node)) setShowBoardMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [setShowBoardMenu]);

  const handleBoardNavigate = useCallback((board: Board) => {
    navigateBoard(board);
    setShowBoardMenu(false);
  }, [navigateBoard, setShowBoardMenu]);

  const handleOpenTeamSettings = useCallback((teamId: string | null | undefined) => {
    if (!teamId) return;
    setTeamSettingsTeamId(teamId);
    setShowTeamSettings(true);
  }, [setShowTeamSettings, setTeamSettingsTeamId]);

  const handleOpenBoardSettings = useCallback((boardId: string | null | undefined) => {
    setShowBoardMenu(false);
    setBoardSettingsBoardId(boardId ?? currentBoard.id);
    setShowBoardSettings(true);
  }, [currentBoard.id, setBoardSettingsBoardId, setShowBoardMenu, setShowBoardSettings]);

  const handleDayRangeUpdate = useCallback((newRange: number) => {
    if (viewMode !== "timeline") return;
    handleDayRangeChange(newRange);
    setTimelineRange(newRange);
    handleUpdateBoard({ day_range: newRange });
  }, [viewMode, handleDayRangeChange, handleUpdateBoard, setTimelineRange]);

  const handleViewModeChange = useCallback((mode: "timeline" | "list") => {
    if (mode === viewMode) return;

    const today = todayJstIso();
    const targetDate =
      data?.days?.[activeDayIndex]?.isoDate ||
      listAnchorDate ||
      resolvedState.date ||
      today;

    if (mode === "timeline") {
      const targetOffset = getDayDiff(targetDate, today);
      // Keep fetch start aligned before timeline range refetch happens on mode switch.
      setDayWindowStart(targetOffset);
      dayWindowStartRef.current = targetOffset;
      pendingTimelineAnchorDateRef.current = targetDate;
      pendingListWindowAutoSyncRef.current = false;
      pendingListWindowAutoSyncAttemptsRef.current = 0;
    } else {
      const anchorOffset = getDayDiff(targetDate, today);
      const startOffset = anchorOffset - listWindow.before;
      // Keep list window aligned even if the initial list-side refetch is delayed.
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
  }, [
    viewMode,
    listAnchorDate,
    data?.days,
    activeDayIndex,
    resolvedState.date,
    listWindow.before,
    setDayWindowStart,
    dayWindowStartRef,
    setActiveDayIndex,
    setListAnchorOffset,
    setListAnchorDate,
    handleSetViewMode,
  ]);

  const getListWindowSpec = useCallback((anchorOffset: number, window: ListWindow) => {
    const range = listWindowRange(window);
    return {
      range,
      startOffset: anchorOffset - window.before,
      anchorIndex: window.before,
      reverse: window.before > 0,
    };
  }, []);

  const fetchListWindow = useCallback(async (anchorOffset: number, window: ListWindow) => {
    if (status === "loading") return;
    const { range, startOffset, anchorIndex } = getListWindowSpec(anchorOffset, window);

    // keep shared window start in sync before list_range updates trigger any dependent refetch
    setDayWindowStart(startOffset);
    dayWindowStartRef.current = startOffset;

    const shouldUpdateBoard =
      currentBoard.list_window_before_days !== window.before ||
      currentBoard.list_window_after_days !== window.after ||
      currentBoard.list_range !== range;
    if (shouldUpdateBoard) {
      handleUpdateBoard({
        list_window_before_days: window.before,
        list_window_after_days: window.after,
        list_range: range,
      });
    }
    const payload = await fetchTimeline(startOffset, { range });
    const anchorDayIndex = Math.min(anchorIndex, Math.max((payload?.days?.length ?? 1) - 1, 0));
    const anchorDay = payload?.days?.[anchorDayIndex] ?? data?.days?.[0];
    if (anchorDay) {
      setListAnchorDate(anchorDay.isoDate);
      setListAnchorOffset(anchorOffset);
      updateUrlForList({
        before: window.before,
        after: window.after,
        date: anchorDay.isoDate,
        time: null,
      });
    }
    setActiveDayIndex(anchorDayIndex);
  }, [status, getListWindowSpec, setDayWindowStart, dayWindowStartRef, currentBoard.list_window_before_days, currentBoard.list_window_after_days, currentBoard.list_range, handleUpdateBoard, fetchTimeline, data?.days, setListAnchorDate, setListAnchorOffset, updateUrlForList, setActiveDayIndex]);

  const shiftListWindow = useCallback((delta: number) => {
    const nextAnchorOffset = listAnchorOffset + delta;
    const nextAnchorDate = addDaysToIsoDate(listAnchorDate || todayJstIso(), delta);
    setListAnchorOffset(nextAnchorOffset);
    setListAnchorDate(nextAnchorDate);
    void fetchListWindow(nextAnchorOffset, listWindow);
  }, [fetchListWindow, listAnchorDate, listAnchorOffset, listWindow, setListAnchorDate, setListAnchorOffset]);

  const handleListPrevDay = useCallback(() => shiftListWindow(-1), [shiftListWindow]);
  const handleListNextDay = useCallback(() => shiftListWindow(1), [shiftListWindow]);
  const handleListPrevWeek = useCallback(() => shiftListWindow(-7), [shiftListWindow]);
  const handleListNextWeek = useCallback(() => shiftListWindow(7), [shiftListWindow]);
  const handleListToday = useCallback(() => {
    const today = todayJstIso();
    setListAnchorOffset(0);
    setListAnchorDate(today);
    void fetchListWindow(0, listWindow);
  }, [fetchListWindow, listWindow, setListAnchorDate, setListAnchorOffset]);
  const handleListWindowPresetChange = useCallback((nextPreset: ListWindowPresetKey) => {
    const nextWindow = LIST_WINDOW_PRESETS[nextPreset];
    setListWindowPresetKey(nextPreset);
    setListWindow(nextWindow);
    void fetchListWindow(listAnchorOffset, nextWindow);
  }, [fetchListWindow, listAnchorOffset, setListWindow, setListWindowPresetKey]);

  const handleListBaseDateChange = useCallback((nextIsoDate: string) => {
    if (!nextIsoDate) return;
    const nextAnchorOffset = getDayDiff(nextIsoDate, todayJstIso());
    setListAnchorOffset(nextAnchorOffset);
    setListAnchorDate(nextIsoDate);
    void fetchListWindow(nextAnchorOffset, listWindow);
  }, [fetchListWindow, listWindow, setListAnchorDate, setListAnchorOffset]);

  useEffect(() => {
    if (viewMode !== "timeline") return;

    const pendingAnchorDate = pendingTimelineAnchorDateRef.current;
    if (!pendingAnchorDate) return;
    if (data?.days?.[0]?.isoDate !== pendingAnchorDate) return;

    setActiveDayIndex(0);
    pendingTimelineAnchorDateRef.current = null;
  }, [data?.days, setActiveDayIndex, viewMode]);

  useEffect(() => {
    if (viewMode !== "list") {
      previousViewModeRef.current = "timeline";
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
      if (data?.startOffset === startOffset && data?.range === range) {
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

    // Wait until ongoing fetch settles; otherwise 0mo window fetch can be skipped.
    if (status === "loading") return;

    if (data?.startOffset === startOffset && data?.range === range) {
      const nextAnchorIndex = Math.min(anchorIndex, Math.max((data.days.length ?? 1) - 1, 0));
      const anchorDay = data.days[nextAnchorIndex];
      if (anchorDay) {
        setListAnchorDate(anchorDay.isoDate);
        setListAnchorOffset(getDayDiff(anchorDay.isoDate, todayJstIso()));
        updateUrlForList({
          before: listWindow.before,
          after: listWindow.after,
          date: anchorDay.isoDate,
          time: null,
        });
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
    viewMode,
    listAnchorOffset,
    listWindow,
    fetchListWindow,
    status,
    data,
    getListWindowSpec,
    setActiveDayIndex,
    setListAnchorDate,
    setListAnchorOffset,
    updateUrlForList,
  ]);

  const eventsByDay = useMemo(() => {
    const result: Record<string, TimelineEvent[]> = {};
    filteredData?.events?.forEach((event) => {
      if (!result[event.due_date]) result[event.due_date] = [];
      result[event.due_date].push(event);
    });
    return result;
  }, [filteredData?.events]);

  const registerAbScrollContainer = useCallback(
    (iso: string, el: HTMLDivElement | null, bucket?: "a" | "b") => {
      const key = bucket ? `${iso}:${bucket}` : iso;
      abScrollContainersRef.current[key] = el;
    },
    []
  );

  const { items: contextMenuItems } = useTimelineCardContextMenuItems({
    contextMenuCardId: contextMenu.cardId,
    data,
    openCardModal,
    handleToggleCardChecked,
    moveCardByDayOffset,
    handleCardModalDelete,
  });

  // グローバルな空間ナビゲーション（物理的な位置に基づいた移動）
  const handleArrowKeyFocus = useSpatialArrowFocus();

  const { timelineViewModel, listViewModel } = useTimelineBoardViewModels({
    days: data?.days ?? [],
    activeDayIndex,
    effectiveDayRange,
    timelineScrollRefDesktop: desktopTimelineScrollRef,
    timelineScrollRefMobile: mobileTimelineScrollRef,
    timelineHeaderRef,
    debouncedHandleScroll,
    handleTimelineViewMount,
    openCardModal,
    handleToggleCardChecked,
    activeResize,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
    calendarEventsByDay,
    calendarAllDayEventsByDay,
    handleExternalEventClick,
    timelineStartHour,
    registerAbScrollContainer,
    status,
    handlePrevDay,
    handleNextDay,
    eventsByDay,
    abBuckets: filteredData?.abBuckets ?? {},
    indicatorTop,
    liveNowIsoDate,
    timelineViewportHeight,
    activeDrag,
    pointerPreview,
    bucketIndicator,
    handleEventKeyDown,
    handleColumnClick,
    handleBucketClick,
    sensors,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
    isOverABList,
    timelineHeaderHeight,
    handleCardContextMenu,
    handleCardContextMenuByKeyboard,
    contextMenuCardId: contextMenu.cardId,
    boardMembers,
    onOpenShareDialog: () => setShowShareDialog(true),
    listBaseDate: listAnchorDate,
    listWindowPresetKey,
    handleListWindowPresetChange,
    listReverse: listWindow.before > 0,
    handleListBaseDateChange,
    handleListPrevDay,
    handleListNextDay,
    handleListPrevWeek,
    handleListNextWeek,
    handleListToday,
  });

  const handleResetInvalidUrl = useCallback(() => {
    router.replace(basePath, { scroll: false });
  }, [basePath, router]);

  const handleMoveToCanonicalUrl = useCallback(() => {
    if (viewMode === "timeline") {
      const fallbackDate = data?.days?.[activeDayIndex]?.isoDate ?? todayJstIso();
      updateUrlForTimeline({
        date: fallbackDate,
        range: timelineRange,
        time: null,
      });
      return;
    }
    updateUrlForList({
      before: listWindow.before,
      after: listWindow.after,
      date: listAnchorDate || todayJstIso(),
      time: null,
    });
  }, [viewMode, data?.days, activeDayIndex, updateUrlForTimeline, timelineRange, updateUrlForList, listWindow.before, listWindow.after, listAnchorDate]);

  if (!parseResult.ok) {
    return (
      <div className="min-h-screen bg-[#f4f5f7] p-6">
        <div className="mx-auto max-w-xl rounded-xl border border-rose-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Invalid/legacy URL</h1>
          <p className="mt-2 text-sm text-slate-600">
            このURLは現在の契約に一致しません。reason: <span className="font-mono text-rose-600">{parseResult.code}</span>
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleResetInvalidUrl}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              URLをリセット
            </button>
            <button
              onClick={handleMoveToCanonicalUrl}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800"
            >
              正規URLへ移動
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f4f5f7]" onKeyDownCapture={handleArrowKeyFocus}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-2 pt-4 md:px-0 md:pt-6">
        <TimelineBoardHeader
          board={currentBoard} modalBoards={availableBoards} modalTeams={availableTeams} handleBoardNavigate={handleBoardNavigate}
          showBoardMenu={showBoardMenu} setShowBoardMenu={setShowBoardMenu} boardMenuRef={boardMenuRef}
          setShowNotificationSettings={setShowNotificationSettings}
          setShowProfileSettings={setShowProfileSettings}
          onOpenBoardSettings={handleOpenBoardSettings}
          onOpenTeamSettings={handleOpenTeamSettings}
          profile={profile} user={user} signOut={signOut}
          showFilters={showFilters} setShowFilters={setShowFilters} hasActiveFilters={hasActiveFilters}
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          selectedTags={selectedTags} setSelectedTags={setSelectedTags}
          availableTags={availableTags} dayRange={intendedDayRange} onDayRangeChange={handleDayRangeUpdate}
          onTodayClick={viewMode === 'list' ? handleListToday : handleTodayClick} realtimeStatus={realtimeStatus} googleToast={googleToast}
          onUpdateBoard={handleUpdateBoard}
          googleStatusText={googleStatusText}
          googleCalendarStatus={googleCalendarStatus} googleCalendarError={googleCalendarError}
          calendarPreset={calendarPreset} setCalendarPreset={setCalendarPreset}
          refreshGoogleCalendar={refreshGoogleCalendar} handleGoogleConnect={handleGoogleConnect}
          isGoogleLoading={googleCalendarStatus === 'loading'} isCalendarRangeReady={!!visibleDays.length}
          viewMode={viewMode} setViewMode={handleViewModeChange}
          onShortcutsClick={() => setShowShortcutsModal(true)}
          onOpenShareDialog={() => setShowShareDialog(true)}
          onPrevDay={viewMode === 'list' ? handleListPrevDay : handlePrevDay}
          onNextDay={viewMode === 'list' ? handleListNextDay : handleNextDay}
          listStartDate={listAnchorDate ?? null}
        />

        {viewMode === 'timeline' ? (
          <>
            <div className="hidden md:block">
              <DesktopTimelineView {...timelineViewModel.desktop} />
            </div>

            <div className="flex-1 overflow-hidden md:hidden">
              <MobileTimelineView {...timelineViewModel.mobile} />
            </div>
          </>
        ) : (
          <>
            <div className="hidden md:block">
              <DesktopListView {...listViewModel.desktop} />
            </div>
            <div className="flex-1 overflow-hidden md:hidden">
              <MobileListView {...listViewModel.mobile} />
            </div>
          </>
        )}

        <TimelineBoardDialogs
          showShareDialog={showShareDialog} setShowShareDialog={setShowShareDialog}
          showNotificationSettings={showNotificationSettings} setShowNotificationSettings={setShowNotificationSettings}
          showProfileSettings={showProfileSettings} setShowProfileSettings={setShowProfileSettings}
          showBoardSettings={showBoardSettings} setShowBoardSettings={setShowBoardSettings}
          boardSettingsBoardId={boardSettingsBoardId}
          showTeamSettings={showTeamSettings} setShowTeamSettings={setShowTeamSettings}
          teamSettingsTeamId={teamSettingsTeamId}
          initialBoard={currentBoard}
          availableBoards={availableBoards}
          fetchProfile={fetchProfile}
          setAvailableBoards={setAvailableBoards}
          setActiveDayIndex={setActiveDayIndex} fetchTimeline={fetchTimeline}
          onMemberAdded={refreshBoardMembers}
        />

        <ShortcutsModal
          isOpen={showShortcutsModal}
          onClose={() => setShowShortcutsModal(false)}
        />

        {modalCard && (cardModalStatus === 'ready' || cardModalStatus === 'loading') && (
          <CardModal
            card={modalCard} boards={availableBoards} profiles={modalProfiles}
            onSave={handleCardModalSave} onDelete={handleCardModalDelete}
            onMoveToBoard={() => { }} onClose={closeCardModal}
            isLoading={cardModalStatus === 'loading'}
            historySaveWarning={historySaveWarning}
            onRetryHistorySave={retryHistorySave}
            onCloseWithoutHistory={closeModalWithoutHistory}
          />
        )}
        {cardModalError && (
          <div className="fixed bottom-4 right-4 z-50 rounded-xl bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
            {cardModalError}
          </div>
        )}

        {contextMenu.open && contextMenu.cardId && (
          <CardContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={closeContextMenu}
            items={contextMenuItems}
          />
        )}
      </div>
    </div>
  );
}
