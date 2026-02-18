"use client";

import type { RefObject } from "react";
import type { User } from "@supabase/supabase-js";
import type { Board, Priority } from "@/lib/supabase";
import type { UserProfile } from "@/app/(board)/_utils/timeline-helpers";
import TimelineHeader from "@/app/(board)/_components/timeline/TimelineHeader";

type TimelineBoardHeaderProps = {
  board: Board;
  modalBoards: Board[];
  handleBoardNavigate: (board: Board) => void;
  showBoardMenu: boolean;
  setShowBoardMenu: (show: boolean | ((prev: boolean) => boolean)) => void;
  boardMenuRef: RefObject<HTMLDivElement>;
  setShowNotificationSettings: (show: boolean) => void;
  setShowProfileSettings: (show: boolean) => void;
  setShowBoardSettings: (show: boolean) => void;
  profile: UserProfile | null;
  user: User | null;
  signOut: () => Promise<void>;
  showFilters: boolean;
  setShowFilters: (show: boolean | ((prev: boolean) => boolean)) => void;
  hasActiveFilters: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedTags: string[];
  setSelectedTags: (tags: string[] | ((prev: string[]) => string[])) => void;
  selectedPriority: "all" | Priority;
  setSelectedPriority: (priority: "all" | Priority) => void;
  availableTags: string[];
  dayRange: number;
  onDayRangeChange: (days: number) => void;
  onTodayClick: () => void;
  onUpdateBoard: (updates: Partial<Board>) => Promise<void>;
  googleStatusText: string;
  googleCalendarStatus: string;
  googleCalendarError: string | null;
  calendarPreset: "visible" | "this-week" | "next-week";
  setCalendarPreset: (preset: "visible" | "this-week" | "next-week") => void;
  refreshGoogleCalendar: () => void;
  handleGoogleConnect: () => void;
  isGoogleLoading: boolean;
  isCalendarRangeReady: boolean;
  realtimeStatus: "connected" | "connecting" | "disconnected";
  googleToast: string | null;
  viewMode: 'timeline' | 'list';
  setViewMode: (mode: 'timeline' | 'list') => void;
  onShortcutsClick: () => void;
  onPrevDay?: () => void;
  onNextDay?: () => void;
  listStartDate?: string | null;
  onOpenShareDialog?: () => void;
};

export default function TimelineBoardHeader({
  board,
  modalBoards,
  handleBoardNavigate,
  showBoardMenu,
  setShowBoardMenu,
  boardMenuRef,
  setShowNotificationSettings,
  setShowProfileSettings,
  setShowBoardSettings,
  profile,
  user,
  signOut,
  showFilters,
  setShowFilters,
  hasActiveFilters,
  searchQuery,
  setSearchQuery,
  selectedTags,
  setSelectedTags,
  selectedPriority,
  setSelectedPriority,
  availableTags,
  dayRange,
  onDayRangeChange,
  onTodayClick,
  onUpdateBoard,
  googleStatusText,
  googleCalendarStatus,
  googleCalendarError,
  calendarPreset,
  setCalendarPreset,
  refreshGoogleCalendar,
  handleGoogleConnect,
  isGoogleLoading,
  isCalendarRangeReady,
  realtimeStatus,
  googleToast,
  viewMode,
  setViewMode,
  onShortcutsClick,
  onPrevDay,
  onNextDay,
  listStartDate,
  onOpenShareDialog,
}: TimelineBoardHeaderProps) {
  return (
    <>
      <TimelineHeader
        board={board}
        modalBoards={modalBoards}
        handleBoardNavigate={handleBoardNavigate}
        showBoardMenu={showBoardMenu}
        setShowBoardMenu={setShowBoardMenu}
        boardMenuRef={boardMenuRef}
        setShowNotificationSettings={setShowNotificationSettings}
        setShowProfileSettings={setShowProfileSettings}
        setShowBoardSettings={setShowBoardSettings}
        profile={profile}
        user={user}
        signOut={signOut}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        hasActiveFilters={hasActiveFilters}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedTags={selectedTags}
        setSelectedTags={setSelectedTags}
        selectedPriority={selectedPriority}
        setSelectedPriority={setSelectedPriority}
        availableTags={availableTags}
        dayRange={dayRange}
        onDayRangeChange={onDayRangeChange}
        onTodayClick={onTodayClick}
        onUpdateBoard={onUpdateBoard}
        googleStatusText={googleStatusText}
        googleCalendarStatus={googleCalendarStatus}
        googleCalendarError={googleCalendarError}
        calendarPreset={calendarPreset}
        setCalendarPreset={setCalendarPreset}
        refreshGoogleCalendar={refreshGoogleCalendar}
        handleGoogleConnect={handleGoogleConnect}
        isGoogleLoading={isGoogleLoading}
        isCalendarRangeReady={isCalendarRangeReady}
        realtimeStatus={realtimeStatus}
        viewMode={viewMode}
        setViewMode={setViewMode}
        onShortcutsClick={onShortcutsClick}
        onPrevDay={onPrevDay}
        onNextDay={onNextDay}
        listStartDate={listStartDate}
        onOpenShareDialog={onOpenShareDialog}
      />
      {googleToast && (
        <div className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white shadow-md">
          {googleToast}
        </div>
      )}
    </>
  );
}
