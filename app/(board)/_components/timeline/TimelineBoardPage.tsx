"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Board, Card } from "@/lib/supabase";
import { buildBoardUrl } from "@/lib/board-url";

import { CardModal } from "@/app/components/CardModal";
import { useAuth } from "@/app/contexts/AuthContext";
import TimelineBoardHeader from "@/app/(board)/_components/timeline/TimelineBoardHeader";
import TimelineBoardDialogs from "@/app/(board)/_components/timeline/TimelineBoardDialogs";
import { DesktopTimelineView } from "@/app/(board)/_components/timeline/DesktopTimelineView";
import MobileTimelineView from "@/app/(board)/_components/timeline/MobileTimelineView";
import { CardContextMenu } from "@/app/(board)/_components/timeline/CardContextMenu";
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

// New hooks
import { useTimelineViewport } from "@/app/(board)/_hooks/useTimelineViewport";
import { useTimelineFiltering } from "@/app/(board)/_hooks/useTimelineFiltering";
import { useTimelineNavigation } from "@/app/(board)/_hooks/useTimelineNavigation";
import { useTimelineCardActions } from "@/app/(board)/_hooks/useTimelineCardActions";

type TimelineBoardPageProps = {
  initialBoard: Board;
};

const DAY_WINDOW_RANGE = DEFAULT_TIMELINE_DAY_RANGE;
const buildMockTimelineResponse = () => buildMockTimeline(DAY_WINDOW_RANGE);

export default function TimelineBoardPage({ initialBoard }: TimelineBoardPageProps) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState(null);
  const [availableBoards, setAvailableBoards] = useState<Board[]>([initialBoard]);
  const [showBoardMenu, setShowBoardMenu] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [showBoardSettings, setShowBoardSettings] = useState(false);
  const boardMenuRef = useRef<HTMLDivElement | null>(null);

  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [calendarPreset, setCalendarPreset] = useState<'visible' | 'this-week' | 'next-week'>('visible');

  // Timeline UI specific settings from profile (fallback to 5)
  const [timelineStartHour, setTimelineStartHour] = useState(5);

  const searchParams = useSearchParams();

  // Individual ranges for each view mode
  const [timelineRange, setTimelineRange] = useState(initialBoard.day_range || 2);
  const [listRange, setListRange] = useState(initialBoard.list_range || 30);

  // View Mode: timeline or list
  const initialViewMode = useMemo(() => {
    const range = searchParams.get('range');
    return range && parseInt(range, 10) >= 30 ? 'list' : 'timeline';
  }, [searchParams]);

  const [viewMode, setViewMode] = useState<'timeline' | 'list'>(initialViewMode);



  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    cardId: string | null;
    x: number;
    y: number;
  }>({ open: false, cardId: null, x: 0, y: 0 });

  const openContextMenuAt = useCallback((cardId: string, x: number, y: number) => {
    setContextMenu({
      open: true,
      cardId,
      x,
      y,
    });
  }, []);

  const handleCardContextMenu = useCallback((e: React.MouseEvent, cardId: string) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenuAt(cardId, e.clientX, e.clientY);
  }, [openContextMenuAt]);

  const handleCardContextMenuByKeyboard = useCallback((cardId: string, rect: DOMRect) => {
    const x = rect.right + 8;
    const y = rect.top;
    openContextMenuAt(cardId, x, y);
  }, [openContextMenuAt]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, open: false, cardId: null }));
  }, []);

  // Fetch profile and boards
  const fetchProfile = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch('/api/profiles');
      if (response.ok) {
        const data = await response.json();
        setProfile(data);
        if (data?.timeline_start_hour !== undefined) {
          setTimelineStartHour(data.timeline_start_hour);
        }
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    }
  }, [user]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // 1. URL State
  const {
    urlDate,
    urlRange,
    urlTime,
    dayWindowStartRef,
    setDayWindowStart,
    updateUrl,
    initialRange: dayRange,
  } = useTimelineUrlState({ initialDayRange: (initialBoard as any).day_range });

  // Compute intended day range based on current viewMode state immediately
  // This avoids flashing when viewMode changes but URL has not yet updated
  const intendedDayRange = useMemo(() => {
    return viewMode === 'timeline' ? timelineRange : listRange;
  }, [viewMode, timelineRange, listRange]);

  // Compute effective range based on mode
  const effectiveDayRange = viewMode === 'timeline' ? Math.min(intendedDayRange, 7) : intendedDayRange;

  const currentBoard = availableBoards.find(b => b.id === initialBoard.id) || initialBoard;

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
  } = useTimelineViewport({ timelineHeaderRef, serverNow: data?.serverNow });

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
  const timelineScrollRef = useMemo(() => ({
    current: desktopTimelineScrollRef.current || mobileTimelineScrollRef.current
  }), [desktopTimelineScrollRef.current, mobileTimelineScrollRef.current]);

  const {
    handlePrevDay,
    handleNextDay,
    handleTodayClick,
    handleDayRangeChange,
  } = useTimelineNavigation({
    data, status, dayRange, activeDayIndex, setActiveDayIndex,
    fetchTimeline, updateUrl, timelineScrollRef, router, dayWindowStartRef
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
    googleCalendarEvents.forEach((event: any) => {
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


  const [createdCardId, setCreatedCardId] = useState<string | null>(null);

  const {
    applyPatch,
    handleCardModalSave,
    handleCardModalDelete,
    handleToggleCardChecked,
    handleUpdateCardTitle,
    handleColumnClick,
    handleBucketClick,
    handleExternalEventClick,
    googleToast,
    setGoogleToast,
  } = useTimelineCardActions({
    initialBoardId: currentBoard.id,
    dataMode, setData, fetchTimeline, openCardModal, closeCardModal,
    modalCard, setModalCardOverride, setCardModalError, setErrorMessage,
    bucketDayMap, googleCalendarEvents, refreshGoogleCalendar, data,
    onCardCreated: setCreatedCardId,
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
  });

  // 10. Scroll Sync
  const indicatorMinutes = liveNowMinutes ?? (data ? getNowMinutesJst(data.serverNow) : null);
  const indicatorTop = indicatorMinutes != null ? minuteToPixels(indicatorMinutes, timelineStartHour) : null;

  const {
    debouncedHandleScroll,
    handleTimelineViewMount,
  } = useTimelineScrollSync({
    urlDate,
    urlRange: (urlRange ?? (currentBoard as any).day_range ?? 2).toString(),
    urlTime,
    data,
    activeDayIndex,
    dayRange: effectiveDayRange,
    indicatorMinutes,
    updateUrl,
    timelineStartHour,
  });

  // Fetch profile and boards
  useEffect(() => {
    fetch('/api/boards').then(r => r.json()).then(b => setAvailableBoards(b.boards || [])).catch(console.error);
  }, [user]);

  // Click outside board menu
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (boardMenuRef.current && !boardMenuRef.current.contains(e.target as Node)) setShowBoardMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleBoardNavigate = useCallback((board: Board) => {
    const target = buildBoardUrl(board);
    router.push(target || `/b/${board.short_id}` || `/board?boardId=${board.id}`);
    setShowBoardMenu(false);
  }, [router]);

  const handleUpdateBoard = useCallback(async (updates: Partial<Board>) => {
    try {
      const response = await fetch(`/api/boards/${currentBoard.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error("Failed to update board");
      const { board: updatedBoard } = await response.json();
      setAvailableBoards((prev) =>
        prev.map((b) => (b.id === updatedBoard.id ? updatedBoard : b)),
      );
    } catch (error) {
      console.error("Failed to update board", error);
      alert("Failed to update board");
    }
  }, [currentBoard.id]);

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

  // グローバルな空間ナビゲーション（物理的な位置に基づいた移動）
  const handleArrowKeyFocus = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    const target = event.target as HTMLElement;
    const tagName = target.tagName;

    // テキスト入力フィールドでのみ矢印キーの標準動作を許可
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable) {
      return;
    }

    const container = event.currentTarget;
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) return;

    // フォーカス可能な要素を取得
    const tabStops = Array.from(container.querySelectorAll(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]):not([disabled])'
    )).filter((el): el is HTMLElement => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        el.getBoundingClientRect().width > 0;
    });

    if (!tabStops.length) return;

    // 現在の要素の矩形情報を取得
    const activeRect = active.getBoundingClientRect();
    const activeCenter = {
      x: activeRect.left + activeRect.width / 2,
      y: activeRect.top + activeRect.height / 2
    };

    let bestCandidate: HTMLElement | null = null;
    let minScore = Infinity;

    for (const candidate of tabStops) {
      if (candidate === active) continue;

      const rect = candidate.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };

      const dx = center.x - activeCenter.x;
      const dy = center.y - activeCenter.y;

      // キーの方向と一致するか確認
      let isCorrectDirection = false;
      let primaryDist = 0;
      let secondaryDist = 0;

      switch (event.key) {
        case 'ArrowRight':
          isCorrectDirection = dx > 0 && Math.abs(dx) > Math.abs(dy) * 0.5;
          primaryDist = dx;
          secondaryDist = dy;
          break;
        case 'ArrowLeft':
          isCorrectDirection = dx < 0 && Math.abs(dx) > Math.abs(dy) * 0.5;
          primaryDist = -dx;
          secondaryDist = dy;
          break;
        case 'ArrowDown':
          isCorrectDirection = dy > 0 && Math.abs(dy) > Math.abs(dx) * 0.5;
          primaryDist = dy;
          secondaryDist = dx;
          break;
        case 'ArrowUp':
          isCorrectDirection = dy < 0 && Math.abs(dy) > Math.abs(dx) * 0.5;
          primaryDist = -dy;
          secondaryDist = dx;
          break;
      }

      if (isCorrectDirection) {
        // スコア計算: 直進方向の距離 + 垂直方向のズレ（重み付け）
        const score = primaryDist + (Math.abs(secondaryDist) * 2.5);
        if (score < minScore) {
          minScore = score;
          bestCandidate = candidate;
        }
      }
    }

    if (bestCandidate) {
      event.preventDefault();
      event.stopPropagation();
      bestCandidate.focus();
      bestCandidate.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#f4f5f7]" onKeyDownCapture={handleArrowKeyFocus}>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 pt-6">
        <TimelineBoardHeader
          board={currentBoard} modalBoards={availableBoards} handleBoardNavigate={handleBoardNavigate}
          showBoardMenu={showBoardMenu} setShowBoardMenu={setShowBoardMenu} boardMenuRef={boardMenuRef}
          setShowShareDialog={setShowShareDialog} setShowNotificationSettings={setShowNotificationSettings}
          setShowProfileSettings={setShowProfileSettings} setShowBoardSettings={setShowBoardSettings}
          profile={profile} user={user} signOut={signOut}
          showFilters={showFilters} setShowFilters={setShowFilters} hasActiveFilters={hasActiveFilters}
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          selectedTags={selectedTags} setSelectedTags={setSelectedTags}
          selectedPriority={selectedPriority} setSelectedPriority={setSelectedPriority}
          availableTags={availableTags} dayRange={intendedDayRange} onDayRangeChange={handleDayRangeUpdate}
          onTodayClick={handleTodayClick} realtimeStatus={realtimeStatus} googleToast={googleToast}
          onUpdateBoard={handleUpdateBoard}
          googleStatusText={googleStatusText}
          googleCalendarStatus={googleCalendarStatus} googleCalendarError={googleCalendarError}
          calendarPreset={calendarPreset} setCalendarPreset={setCalendarPreset}
          refreshGoogleCalendar={refreshGoogleCalendar} handleGoogleConnect={handleGoogleConnect}
          isGoogleLoading={googleCalendarStatus === 'loading'} isCalendarRangeReady={!!visibleDays.length}
          viewMode={viewMode} setViewMode={handleSetViewMode}
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
                registerAbScrollContainer={(iso, el) => { abScrollContainersRef.current[iso] = el; }}
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
                onUpdateCardTitle={handleUpdateCardTitle}
                createdCardId={createdCardId}
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
                registerAbScrollContainer={(iso, el) => { abScrollContainersRef.current[iso] = el; }}
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
        />

        {modalCard && (cardModalStatus === 'ready' || cardModalStatus === 'loading') && (
          <CardModal
            card={modalCard} boards={availableBoards} profiles={modalProfiles}
            onSave={handleCardModalSave} onDelete={handleCardModalDelete}
            onMoveToBoard={() => { }} onClose={closeCardModal}
            isLoading={cardModalStatus === 'loading'}
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
            items={[
              {
                label: "カードを開く",
                onClick: () => {
                  const card =
                    data?.events?.find((e: any) => e.card_id === contextMenu.cardId) ||
                    Object.values(data?.abBuckets || {}).flat().find((i: any) => (i as any).card_id === contextMenu.cardId);
                  if (card?.short_id) openCardModal(card.short_id, "context-menu");
                }
              },
              {
                label: (
                  (data?.events?.find((e: any) => e.card_id === contextMenu.cardId)?.checked ||
                    Object.values(data?.abBuckets || {}).flat().find((i: any) => (i as any).card_id === contextMenu.cardId)?.checked)
                    ? "未完了に戻す" : "完了にする"
                ),
                onClick: () => {
                  const isChecked =
                    data?.events?.find((e: any) => e.card_id === contextMenu.cardId)?.checked ||
                    Object.values(data?.abBuckets || {}).flat().find((i: any) => (i as any).card_id === contextMenu.cardId)?.checked;
                  handleToggleCardChecked(contextMenu.cardId!, !isChecked);
                }
              },
              {
                label: "削除",
                variant: "danger",
                onClick: () => {
                  if (confirm("カードを削除しますか？")) {
                    handleCardModalDelete(contextMenu.cardId!);
                  }
                }
              }
            ]}
          />
        )}
      </div>
    </div>
  );
}
