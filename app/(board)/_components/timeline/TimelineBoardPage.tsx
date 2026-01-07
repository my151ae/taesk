"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Board, Card } from "@/lib/supabase";
import { buildBoardUrl } from "@/lib/board-url";

import { CardModal } from "@/app/components/CardModal";
import { useAuth } from "@/app/contexts/AuthContext";
import TimelineBoardHeader from "@/app/(board)/_components/timeline/TimelineBoardHeader";
import TimelineBoardDialogs from "@/app/(board)/_components/timeline/TimelineBoardDialogs";
import { DesktopTimelineView } from "@/app/(board)/_components/timeline/DesktopTimelineView";
import MobileTimelineView from "@/app/(board)/_components/timeline/MobileTimelineView";
import {
  type TimelineEvent,
  minuteToPixels,
  getNowMinutesJst,
  DEFAULT_TIMELINE_DAY_RANGE,
} from "@/app/(board)/_utils/timeline-helpers";
import { buildMockTimeline } from "@/app/(board)/_utils/timeline-board-helpers";

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
    dayRange,
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
    return days.slice(activeDayIndex, activeDayIndex + dayRange);
  }, [activeDayIndex, data?.days, dayRange]);

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

  // 8. Card Actions & External Sync
  const bucketDayMap = useMemo(() => {
    const result: Record<string, string | null> = {};
    data?.days?.forEach((day) => {
      result[`${day.key}_a`] = day.isoDate;
      result[`${day.key}_b`] = day.isoDate;
    });
    return result;
  }, [data?.days]);

  const currentBoard = availableBoards.find(b => b.id === initialBoard.id) || initialBoard;

  const {
    applyPatch,
    handleCardModalSave,
    handleCardModalDelete,
    handleToggleCardChecked,
    handleColumnClick,
    handleBucketClick,
    handleExternalEventClick,
    googleToast,
    setGoogleToast,
  } = useTimelineCardActions({
    initialBoardId: currentBoard.id,
    dataMode, setData, fetchTimeline, openCardModal, closeCardModal,
    modalCard, setModalCardOverride, setCardModalError, setErrorMessage,
    bucketDayMap, googleCalendarEvents, refreshGoogleCalendar
  });

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
    dayRange,
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

  const eventsByDay = useMemo(() => {
    const result: Record<string, TimelineEvent[]> = {};
    filteredData?.events?.forEach((event) => {
      if (!result[event.due_date]) result[event.due_date] = [];
      result[event.due_date].push(event);
    });
    return result;
  }, [filteredData?.events]);

  return (
    <div className="min-h-screen bg-[#f4f5f7]">
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
          availableTags={availableTags} dayRange={dayRange} onDayRangeChange={handleDayRangeChange}
          onTodayClick={handleTodayClick} realtimeStatus={realtimeStatus} googleToast={googleToast}
          onUpdateBoard={async (updates) => {
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
          }}
          googleStatusText={googleCalendarStatus === 'loading' ? 'Google予定同期中...' : 'Google予定表示中'}
          googleCalendarStatus={googleCalendarStatus} googleCalendarError={googleCalendarError}
          calendarPreset={calendarPreset} setCalendarPreset={setCalendarPreset}
          refreshGoogleCalendar={refreshGoogleCalendar} handleGoogleConnect={() => { }}
          isGoogleLoading={googleCalendarStatus === 'loading'} isCalendarRangeReady={!!visibleDays.length}
        />

        <div className="hidden md:block">
          <DesktopTimelineView
            days={data?.days ?? []}
            activeDayIndex={activeDayIndex}
            dayRange={dayRange}
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
          />
        </div>

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
          />
        )}
        {cardModalError && (
          <div className="fixed bottom-4 right-4 z-50 rounded-xl bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
            {cardModalError}
          </div>
        )}
      </div>
    </div>
  );
}
