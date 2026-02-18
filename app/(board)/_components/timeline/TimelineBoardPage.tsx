"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Board, Card } from "@/lib/supabase";

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
import { useBoardMembers } from "@/app/(board)/_hooks/useBoardMembers";
import { useBoardMembersStore } from "@/app/(board)/_stores/board-members-store";
import { useTimelineContextMenu } from "@/app/(board)/_hooks/useTimelineContextMenu";
import { useTimelineBoardShell } from "@/app/(board)/_hooks/useTimelineBoardShell";
import { useSpatialArrowFocus } from "@/app/(board)/_hooks/useSpatialArrowFocus";
import { useTimelineCardContextMenuItems } from "@/app/(board)/_hooks/useTimelineCardContextMenuItems";

type TimelineBoardPageProps = {
  initialBoard: Board;
};

const DAY_WINDOW_RANGE = DEFAULT_TIMELINE_DAY_RANGE;
const buildMockTimelineResponse = () => buildMockTimeline(DAY_WINDOW_RANGE);
const dayDiffFromIso = (fromIso: string, toIso: string) => {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
};
const todayJstIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export default function TimelineBoardPage({ initialBoard }: TimelineBoardPageProps) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [showBoardMenu, setShowBoardMenu] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [showBoardSettings, setShowBoardSettings] = useState(false);
  const boardMenuRef = useRef<HTMLDivElement | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [calendarPreset, setCalendarPreset] = useState<'visible' | 'this-week' | 'next-week'>('visible');

  // Timeline UI specific settings from profile (fallback to 5)
  const [timelineStartHour, setTimelineStartHour] = useState(5);

  const hourHeight = useTimelineZoomStore((state) => state.hourHeight); // [NEW]

  const searchParams = useSearchParams();

  // Individual ranges for each view mode
  const [timelineRange, setTimelineRange] = useState(initialBoard.day_range || 2);
  const [listRange, setListRange] = useState(initialBoard.list_range || 30);
  const [listBaseDate, setListBaseDate] = useState<string>(() => todayJstIso());
  const [listBaseOffset, setListBaseOffset] = useState(0);
  const [listMonthDirection, setListMonthDirection] = useState<1 | 2 | 3 | -1 | -2 | -3>(1);

  // View Mode: timeline or list
  const initialViewMode = useMemo(() => {
    const range = searchParams.get('range');
    return range && parseInt(range, 10) >= 30 ? 'list' : 'timeline';
  }, [searchParams]);

  const [viewMode, setViewMode] = useState<'timeline' | 'list'>(initialViewMode);
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
  const {
    urlDate,
    urlRange,
    urlTime,
    dayWindowStartRef,
    setDayWindowStart,
    updateUrl,
    initialRange: dayRange,
  } = useTimelineUrlState({ initialDayRange: initialBoard.day_range });

  // Compute intended day range based on current viewMode state immediately
  // This avoids flashing when viewMode changes but URL has not yet updated
  const intendedDayRange = useMemo(() => {
    return viewMode === 'timeline' ? timelineRange : listRange;
  }, [viewMode, timelineRange, listRange]);

  // Compute effective range based on mode
  const effectiveDayRange = viewMode === 'timeline' ? Math.min(intendedDayRange, 7) : intendedDayRange;

  const { boardMembers, setBoardMembers } = useBoardMembers(initialBoard.id);
  const { setMembers: setStoredMembers } = useBoardMembersStore();
  const {
    profile,
    availableBoards,
    setAvailableBoards,
    fetchProfile,
    refreshBoardMembers,
    handleBoardNavigate: navigateBoard,
    handleUpdateBoard,
  } = useTimelineBoardShell({
    initialBoard,
    currentBoardId: initialBoard.id,
    userId: user?.id,
    router,
    onTimelineStartHour: setTimelineStartHour,
    setBoardMembers,
    setStoredMembers,
  });
  const currentBoard = availableBoards.find((b) => b.id === initialBoard.id) || initialBoard;

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
    selectedPriority, setSelectedPriority,
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
    data, status, dayRange, activeDayIndex, setActiveDayIndex,
    fetchTimeline, updateUrl, timelineScrollRef, router, dayWindowStartRef,
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
    urlDate,
    urlRange: (urlRange ?? currentBoard.day_range ?? 2).toString(),
    urlTime,
    data,
    activeDayIndex,
    dayRange: effectiveDayRange,
    indicatorMinutes,
    updateUrl,
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
  }, []);

  const handleBoardNavigate = useCallback((board: Board) => {
    navigateBoard(board);
    setShowBoardMenu(false);
  }, [navigateBoard]);

  const handleDayRangeUpdate = useCallback((newRange: number) => {
    handleDayRangeChange(newRange);
    if (viewMode === 'timeline') {
      setTimelineRange(newRange);
      handleUpdateBoard({ day_range: newRange });
    } else {
      setListRange(newRange);
      handleUpdateBoard({ list_range: newRange });
    }
  }, [viewMode, handleDayRangeChange, handleUpdateBoard]);

  const fetchListWindow = useCallback(async (baseOffset: number, monthDirection: 1 | 2 | 3 | -1 | -2 | -3) => {
    if (status === "loading") return;
    const range = Math.abs(monthDirection) * 30;
    if (listRange !== range) {
      setListRange(range);
      handleUpdateBoard({ list_range: range });
    }
    const startOffset = monthDirection > 0 ? baseOffset : baseOffset - (range - 1);
    const payload = await fetchTimeline(startOffset, { range });
    const anchorIndex = monthDirection > 0 ? 0 : Math.max(0, range - 1);
    const anchorDay = payload?.days?.[Math.min(anchorIndex, Math.max((payload?.days?.length ?? 1) - 1, 0))] ?? data?.days?.[0];
    if (anchorDay) updateUrl(anchorDay.isoDate, range, null);
    setActiveDayIndex(0);
  }, [status, listRange, handleUpdateBoard, fetchTimeline, data?.days, updateUrl]);

  const shiftListWindow = useCallback((delta: number) => {
    const nextBaseOffset = listBaseOffset + delta;
    setListBaseOffset(nextBaseOffset);
    setListBaseDate((prev) => {
      const base = prev || todayJstIso();
      const d = new Date(`${base}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + delta);
      return d.toISOString().slice(0, 10);
    });
    void fetchListWindow(nextBaseOffset, listMonthDirection);
  }, [listBaseOffset, fetchListWindow, listMonthDirection]);

  const handleListPrevDay = useCallback(() => shiftListWindow(-1), [shiftListWindow]);
  const handleListNextDay = useCallback(() => shiftListWindow(1), [shiftListWindow]);
  const handleListPrevWeek = useCallback(() => shiftListWindow(-7), [shiftListWindow]);
  const handleListNextWeek = useCallback(() => shiftListWindow(7), [shiftListWindow]);
  const handleListToday = useCallback(() => {
    const today = todayJstIso();
    setListBaseOffset(0);
    setListBaseDate(today);
    void fetchListWindow(0, listMonthDirection);
  }, [fetchListWindow, listMonthDirection]);
  const handleListMonthDirectionChange = useCallback((nextDirection: 1 | 2 | 3 | -1 | -2 | -3) => {
    setListMonthDirection(nextDirection);
    void fetchListWindow(listBaseOffset, nextDirection);
  }, [listBaseOffset, fetchListWindow]);

  const handleListBaseDateChange = useCallback((nextIsoDate: string) => {
    if (!nextIsoDate || !listBaseDate) return;
    const delta = dayDiffFromIso(listBaseDate, nextIsoDate);
    const nextBaseOffset = listBaseOffset + delta;
    setListBaseOffset(nextBaseOffset);
    setListBaseDate(nextIsoDate);
    void fetchListWindow(nextBaseOffset, listMonthDirection);
  }, [listBaseDate, listBaseOffset, fetchListWindow, listMonthDirection]);

  const handleSetViewMode = useCallback((mode: 'timeline' | 'list') => {
    setViewMode(mode);
    const targetRange = mode === 'timeline' ? timelineRange : listRange;

    // Direct URL update to be more reliable than handleDayRangeChange
    // which might guard against missing data
    const currentDayIso = data?.days?.[activeDayIndex]?.isoDate || urlDate || new Date().toISOString().split('T')[0];
    updateUrl(currentDayIso, targetRange, null);
  }, [timelineRange, listRange, updateUrl, data?.days, activeDayIndex, urlDate]);

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

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f4f5f7]" onKeyDownCapture={handleArrowKeyFocus}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-2 pt-4 md:px-0 md:pt-6">
        <TimelineBoardHeader
          board={currentBoard} modalBoards={availableBoards} handleBoardNavigate={handleBoardNavigate}
          showBoardMenu={showBoardMenu} setShowBoardMenu={setShowBoardMenu} boardMenuRef={boardMenuRef}
          setShowNotificationSettings={setShowNotificationSettings}
          setShowProfileSettings={setShowProfileSettings} setShowBoardSettings={setShowBoardSettings}
          profile={profile} user={user} signOut={signOut}
          showFilters={showFilters} setShowFilters={setShowFilters} hasActiveFilters={hasActiveFilters}
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          selectedTags={selectedTags} setSelectedTags={setSelectedTags}
          selectedPriority={selectedPriority} setSelectedPriority={setSelectedPriority}
          availableTags={availableTags} dayRange={intendedDayRange} onDayRangeChange={handleDayRangeUpdate}
          onTodayClick={viewMode === 'list' ? handleListToday : handleTodayClick} realtimeStatus={realtimeStatus} googleToast={googleToast}
          onUpdateBoard={handleUpdateBoard}
          googleStatusText={googleStatusText}
          googleCalendarStatus={googleCalendarStatus} googleCalendarError={googleCalendarError}
          calendarPreset={calendarPreset} setCalendarPreset={setCalendarPreset}
          refreshGoogleCalendar={refreshGoogleCalendar} handleGoogleConnect={handleGoogleConnect}
          isGoogleLoading={googleCalendarStatus === 'loading'} isCalendarRangeReady={!!visibleDays.length}
          viewMode={viewMode} setViewMode={handleSetViewMode}
          onShortcutsClick={() => setShowShortcutsModal(true)}
          onPrevDay={viewMode === 'list' ? handleListPrevDay : handlePrevDay}
          onNextDay={viewMode === 'list' ? handleListNextDay : handleNextDay}
          listStartDate={listBaseDate ?? null}
        />

        {viewMode === 'timeline' ? (
          <>
            <div className="hidden md:block">
              <DesktopTimelineView
                days={data?.days ?? []}
                activeDayIndex={activeDayIndex}
                dayRange={effectiveDayRange}
                timelineScrollRef={desktopTimelineScrollRef}
                onScroll={debouncedHandleScroll}
                onMount={handleTimelineViewMount}
                openCardModal={openCardModal}
                onToggleCheck={handleToggleCardChecked}
                activeResize={activeResize}
                handleResizeStart={handleResizeStart}
                handleResizeMove={handleResizeMove}
                handleResizeEnd={handleResizeEnd}
                calendarEventsByDay={calendarEventsByDay}
                onExternalEventClick={handleExternalEventClick}
                timelineStartHour={timelineStartHour}
                timelineHeaderRef={timelineHeaderRef}
                registerAbScrollContainer={registerAbScrollContainer}
                status={status}
                handlePrevDay={handlePrevDay}
                handleNextDay={handleNextDay}
                eventsByDay={eventsByDay}
                abBuckets={filteredData?.abBuckets ?? {}}
                indicatorTop={indicatorTop}
                indicatorDayIso={liveNowIsoDate}
                timelineViewportHeight={timelineViewportHeight}
                activeDrag={activeDrag}
                pointerPreview={pointerPreview}
                bucketIndicator={bucketIndicator}
                handleEventKeyDown={handleEventKeyDown}
                handleColumnClick={handleColumnClick}
                onCreateBucketCard={handleBucketClick}
                sensors={sensors}
                handleDragStart={handleDragStart}
                handleDragMove={handleDragMove}
                handleDragEnd={handleDragEnd}
                handleDragCancel={handleDragCancel}
                isOverABList={isOverABList}
                floatingLayerTop={timelineHeaderHeight}
                calendarAllDayByDay={calendarAllDayEventsByDay}
                onCardContextMenu={handleCardContextMenu}
                onCardContextMenuByKeyboard={handleCardContextMenuByKeyboard}
                contextMenuCardId={contextMenu.cardId}
                boardMembers={boardMembers}
                onOpenShareDialog={() => setShowShareDialog(true)}
              />
            </div>

            <div className="flex-1 overflow-hidden md:hidden">
              <MobileTimelineView
                timelineScrollRef={mobileTimelineScrollRef}
                days={data?.days ?? []}
                activeDayIndex={activeDayIndex}
                onPrevDay={handlePrevDay}
                onNextDay={handleNextDay}
                onMount={handleTimelineViewMount}
                onScroll={debouncedHandleScroll}
                registerAbScrollContainer={registerAbScrollContainer}
                eventsByDay={eventsByDay}
                abBuckets={filteredData?.abBuckets ?? {}}
                calendarEventsByDay={calendarEventsByDay}
                calendarAllDayByDay={calendarAllDayEventsByDay}
                indicatorTop={indicatorTop}
                indicatorDayIso={liveNowIsoDate}
                timelineViewportHeight={timelineViewportHeight}
                openCardModal={openCardModal}
                onCreateBucketCard={handleBucketClick}
                onToggleCheck={handleToggleCardChecked}
                status={status}
                activeDrag={activeDrag}
                sensors={sensors}
                handleDragStart={handleDragStart}
                handleDragMove={handleDragMove}
                handleDragEnd={handleDragEnd}
                handleDragCancel={handleDragCancel}
                bucketIndicator={bucketIndicator}
                isOverABList={isOverABList}
                pointerPreview={pointerPreview}
                onExternalEventClick={handleExternalEventClick}
                timelineStartHour={timelineStartHour}
                onCardContextMenu={handleCardContextMenu}
                onCardContextMenuByKeyboard={handleCardContextMenuByKeyboard}
                contextMenuCardId={contextMenu.cardId}
                boardMembers={boardMembers}
                onOpenShareDialog={() => setShowShareDialog(true)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="hidden md:block">
              <DesktopListView
                days={data?.days ?? []}
                eventsByDay={eventsByDay}
                abBuckets={filteredData?.abBuckets ?? {}}
                calendarEventsByDay={calendarEventsByDay}
                calendarAllDayEventsByDay={calendarAllDayEventsByDay}
                openCardModal={openCardModal}
                onToggleCheck={handleToggleCardChecked}
                onExternalEventClick={handleExternalEventClick}
                onCardContextMenu={handleCardContextMenu}
                status={status}
                onPrevDay={handleListPrevDay}
                onNextDay={handleListNextDay}
                onPrevWeek={handleListPrevWeek}
                onNextWeek={handleListNextWeek}
                onToday={handleListToday}
                listBaseDate={listBaseDate}
                listMonthDirection={listMonthDirection}
                onListMonthDirectionChange={handleListMonthDirectionChange}
                onListBaseDateChange={handleListBaseDateChange}
              />
            </div>
            <div className="flex-1 overflow-hidden md:hidden">
              <MobileListView
                days={data?.days ?? []}
                eventsByDay={eventsByDay}
                abBuckets={filteredData?.abBuckets ?? {}}
                calendarEventsByDay={calendarEventsByDay}
                calendarAllDayEventsByDay={calendarAllDayEventsByDay}
                openCardModal={openCardModal}
                onToggleCheck={handleToggleCardChecked}
                onExternalEventClick={handleExternalEventClick}
                onCardContextMenu={handleCardContextMenu}
                status={status}
                onPrevDay={handleListPrevDay}
                onNextDay={handleListNextDay}
                onPrevWeek={handleListPrevWeek}
                onNextWeek={handleListNextWeek}
                listBaseDate={listBaseDate}
                listMonthDirection={listMonthDirection}
                onListMonthDirectionChange={handleListMonthDirectionChange}
                onListBaseDateChange={handleListBaseDateChange}
              />
            </div>
          </>
        )}

        <TimelineBoardDialogs
          showShareDialog={showShareDialog} setShowShareDialog={setShowShareDialog}
          showNotificationSettings={showNotificationSettings} setShowNotificationSettings={setShowNotificationSettings}
          showProfileSettings={showProfileSettings} setShowProfileSettings={setShowProfileSettings}
          showBoardSettings={showBoardSettings} setShowBoardSettings={setShowBoardSettings}
          initialBoard={currentBoard} fetchProfile={fetchProfile} setAvailableBoards={setAvailableBoards}
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
