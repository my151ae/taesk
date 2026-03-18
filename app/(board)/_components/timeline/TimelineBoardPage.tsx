"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Board } from "@/lib/supabase";
import { buildBoardUrl } from "@/lib/board-url";
import { sortTimelineOverdueItems, type OverdueSortOrder } from "@/lib/timeline-overdue-sort";

import { useAuth } from "@/app/contexts/AuthContext";
import TimelineBoardScreen from "@/app/(board)/_components/timeline/TimelineBoardScreen";
import {
  type TimelineEvent,
  minuteToPixels,
  getNowMinutesJst,
  getDayDiff,
  DEFAULT_TIMELINE_DAY_RANGE,
} from "@/app/(board)/_utils/timeline-helpers";
import { buildMockTimeline } from "@/app/(board)/_utils/timeline-board-helpers";
import { type SidebarSectionKey } from "@/app/(board)/_components/timeline/DesktopSidebarMenu";

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
import { useTimelineCardContextMenuItems } from "@/app/(board)/_hooks/useTimelineCardContextMenuItems";
import { useTimelineBoardInitialization } from "@/app/(board)/_hooks/useTimelineBoardInitialization";
import { useTimelineBoardViewModels } from "@/app/(board)/_hooks/useTimelineBoardViewModels";
import { buildTimelineOverlayState } from "@/app/(board)/_components/timeline/timeline-render-model";
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

const canPersistBoardPreferences = (board: Board) => {
  if (!board.membership_role) return true;
  return board.membership_role === "owner" || board.membership_role === "editor";
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
  const [expandedSectionKey, setExpandedSectionKey] = useState<SidebarSectionKey | null>("overdue");

  const {
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
    filteredData,
    searchResults,
  } = useTimelineFiltering(data);
  const [overdueSortOrder, setOverdueSortOrder] = useState<OverdueSortOrder>("newest");
  const sortedFilteredData = useMemo(() => {
    if (!filteredData) return null;
    return {
      ...filteredData,
      overdue: sortTimelineOverdueItems(filteredData.overdue, overdueSortOrder),
    };
  }, [filteredData, overdueSortOrder]);

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
    handlePrevDayRange,
    handleNextDayRange,
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
    data: sortedFilteredData, setData, applyPatch, timelineScrollRef,
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
    if (canPersistBoardPreferences(currentBoard)) {
      void handleUpdateBoard({ day_range: newRange });
    }
  }, [viewMode, handleDayRangeChange, handleUpdateBoard, setTimelineRange, currentBoard]);

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
    sortedFilteredData?.events?.forEach((event) => {
      if (!result[event.due_date]) result[event.due_date] = [];
      result[event.due_date].push(event);
    });
    return result;
  }, [sortedFilteredData?.events]);

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

  const activeDragCardId = activeDrag?.cardId ?? null;
  const { overlayBucketEntry, overlayOverdueEntry, overlayTimelineEvent, overlayCardData } = useMemo(
    () =>
      buildTimelineOverlayState({
        abBuckets: sortedFilteredData?.abBuckets ?? {},
        overdue: sortedFilteredData?.overdue ?? [],
        events: sortedFilteredData?.events ?? [],
        activeDragCardId,
        defaultTimelineDuration: 60,
      }),
    [sortedFilteredData?.abBuckets, sortedFilteredData?.overdue, sortedFilteredData?.events, activeDragCardId]
  );

  const viewModels = useTimelineBoardViewModels({
    viewMode,
    expandedSectionKey,
    onExpandedSectionChange: setExpandedSectionKey,
    days: data?.days ?? [],
    activeDayIndex,
    intendedDayRange,
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
    handlePrevDayRange,
    handleNextDayRange,
    handleDayRangeChange: handleDayRangeUpdate,
    handleTodayClick,
    eventsByDay,
    abBuckets: sortedFilteredData?.abBuckets ?? {},
    overdue: sortedFilteredData?.overdue ?? [],
    searchQuery,
    setSearchQuery,
    searchResults,
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
    handleViewModeChange,
  });

  const desktopActiveView = viewModels.desktop.mainPanel.tabs.activeKey;
  const desktopTabItems = viewModels.desktop.mainPanel.tabs.items.filter((item) =>
    viewModels.desktop.mainPanel.tabs.availableKeys.includes(item.key)
  );

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

  const headerProps = {
    board: currentBoard,
    modalBoards: availableBoards,
    modalTeams: availableTeams,
    handleBoardNavigate,
    showBoardMenu,
    setShowBoardMenu,
    boardMenuRef,
    setShowNotificationSettings,
    setShowProfileSettings,
    onOpenBoardSettings: handleOpenBoardSettings,
    onOpenTeamSettings: handleOpenTeamSettings,
    profile,
    user,
    signOut,
    dayRange: intendedDayRange,
    onDayRangeChange: handleDayRangeUpdate,
    onTodayClick: viewMode === "list" ? handleListToday : handleTodayClick,
    realtimeStatus,
    googleToast,
    googleStatusText,
    googleCalendarStatus,
    googleCalendarError,
    calendarPreset,
    setCalendarPreset,
    refreshGoogleCalendar,
    handleGoogleConnect,
    isGoogleLoading: googleCalendarStatus === "loading",
    viewMode,
    onShortcutsClick: () => setShowShortcutsModal(true),
  };

  const leftPanelProps = {
    state: viewModels.desktop.leftPanel.state,
    actions: viewModels.desktop.leftPanel.actions,
    sections: viewModels.desktop.leftPanel.sections,
    allowOverdueDrag: viewModels.desktop.leftPanel.allowOverdueDrag,
    openCardModal,
    onToggleCheck: handleToggleCardChecked,
    onCardContextMenu: handleCardContextMenu,
    onCardContextMenuByKeyboard: handleCardContextMenuByKeyboard,
    contextMenuCardId: contextMenu.cardId,
  };

  return (
    <TimelineBoardScreen
      parseResult={parseResult}
      onResetInvalidUrl={handleResetInvalidUrl}
      onMoveToCanonicalUrl={handleMoveToCanonicalUrl}
      headerProps={headerProps}
      desktop={{
        activeView: desktopActiveView,
        tabItems: desktopTabItems,
        onTabChange: viewModels.desktop.mainPanel.tabs.onChange,
        leftPanelProps,
        overdueSortOrder,
        onOverdueSortOrderChange: setOverdueSortOrder,
        timelineToolbarProps: viewModels.desktop.mainPanel.views.timeline.toolbar,
        timelineViewProps: viewModels.desktop.mainPanel.views.timeline.body,
        listToolbarProps: viewModels.desktop.mainPanel.views.list.toolbar,
        listViewProps: viewModels.desktop.mainPanel.views.list.body,
        dndProps: {
          sensors,
          handleDragStart,
          handleDragMove,
          handleDragEnd,
          handleDragCancel,
        },
        overlayProps: {
          overlayCardData,
          overlayTimelineEvent,
          overlayBucketCard: overlayBucketEntry?.item ?? null,
          overlayOverdueCard: overlayOverdueEntry?.item ?? null,
        },
      }}
      mobile={{
        viewMode,
        timelineProps: viewModels.mobile.timeline,
        listProps: viewModels.mobile.list,
        overdueSortOrder,
        onOverdueSortOrderChange: setOverdueSortOrder,
      }}
      dialogsProps={{
        showShareDialog,
        setShowShareDialog,
        showNotificationSettings,
        setShowNotificationSettings,
        showProfileSettings,
        setShowProfileSettings,
        showBoardSettings,
        setShowBoardSettings,
        boardSettingsBoardId,
        showTeamSettings,
        setShowTeamSettings,
        teamSettingsTeamId,
        initialBoard: currentBoard,
        availableBoards,
        fetchProfile,
        setAvailableBoards,
        setActiveDayIndex,
        fetchTimeline,
        onMemberAdded: refreshBoardMembers,
      }}
      shortcutsProps={{
        isOpen: showShortcutsModal,
        onClose: () => setShowShortcutsModal(false),
      }}
      modalProps={
        modalCard && (cardModalStatus === "ready" || cardModalStatus === "loading")
          ? {
              card: modalCard,
              boards: availableBoards,
              profiles: modalProfiles,
              onSave: handleCardModalSave,
              onDelete: handleCardModalDelete,
              onMoveToBoard: () => {},
              onClose: closeCardModal,
              isLoading: cardModalStatus === "loading",
              historySaveWarning,
              onRetryHistorySave: retryHistorySave,
              onCloseWithoutHistory: closeModalWithoutHistory,
            }
          : null
      }
      cardModalError={cardModalError}
      contextMenu={
        contextMenu.open && contextMenu.cardId
          ? {
              open: true,
              cardId: contextMenu.cardId,
              x: contextMenu.x,
              y: contextMenu.y,
              items: contextMenuItems,
              onClose: () => closeContextMenu("dismiss"),
            }
          : {
              open: false,
              cardId: contextMenu.cardId,
            }
      }
    />
  );
}
