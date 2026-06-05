"use client";

import type { RefObject } from "react";
import type { User } from "@supabase/supabase-js";
import type { Board, TeamView } from "@/lib/supabase";
import type { UserProfile } from "@/app/(board)/_utils/timeline-helpers";
import type { GoogleCalendarListEntry, GoogleCalendarPartialError } from "@/lib/api-types/google-calendar";
import TimelineHeader from "@/app/(board)/_components/timeline/TimelineHeader";

type TimelineBoardHeaderProps = {
  board: Board;
  modalBoards: Board[];
  modalTeams: TeamView[];
  handleBoardNavigate: (board: Board) => void;
  showBoardMenu: boolean;
  setShowBoardMenu: (show: boolean | ((prev: boolean) => boolean)) => void;
  boardMenuRef: RefObject<HTMLDivElement>;
  setShowNotificationSettings: (show: boolean) => void;
  onOpenNotificationsPanel: () => void;
  setShowProfileSettings: (show: boolean) => void;
  onOpenBoardSettings: (boardId: string | null | undefined) => void;
  onOpenTeamSettings: (teamId: string | null | undefined) => void;
  profile: UserProfile | null;
  user: User | null;
  signOut: () => Promise<void>;
  dayRange: number;
  onDayRangeChange: (days: number) => void;
  onTodayClick: () => void;
  googleStatusText: string;
  googleCalendarStatus: string;
  googleCalendarError: string | null;
  googleCalendars: GoogleCalendarListEntry[];
  selectedGoogleCalendarIds: string[];
  googleCalendarPartialErrors: GoogleCalendarPartialError[];
  googleCalendarSelectionStatus: "idle" | "saving" | "error";
  updateGoogleCalendarSelection: (selectedCalendarIds: string[]) => Promise<void>;
  calendarPreset: "visible" | "this-week" | "next-week";
  setCalendarPreset: (preset: "visible" | "this-week" | "next-week") => void;
  refreshGoogleCalendar: () => void;
  handleGoogleConnect: () => void;
  isGoogleLoading: boolean;
  realtimeStatus: "connected" | "connecting" | "disconnected";
  googleToast: string | null;
  viewMode: 'timeline' | 'list' | 'month';
  onShortcutsClick: () => void;
  collapsed?: boolean;
};

export default function TimelineBoardHeader({
  board,
  modalBoards,
  modalTeams,
  handleBoardNavigate,
  showBoardMenu,
  setShowBoardMenu,
  boardMenuRef,
  setShowNotificationSettings,
  onOpenNotificationsPanel,
  setShowProfileSettings,
  onOpenBoardSettings,
  onOpenTeamSettings,
  profile,
  user,
  signOut,
  dayRange,
  onDayRangeChange,
  onTodayClick,
  googleStatusText,
  googleCalendarStatus,
  googleCalendarError,
  googleCalendars,
  selectedGoogleCalendarIds,
  googleCalendarPartialErrors,
  googleCalendarSelectionStatus,
  updateGoogleCalendarSelection,
  calendarPreset,
  setCalendarPreset,
  refreshGoogleCalendar,
  handleGoogleConnect,
  isGoogleLoading,
  realtimeStatus,
  googleToast,
  viewMode,
  onShortcutsClick,
  collapsed = false,
}: TimelineBoardHeaderProps) {
  return (
    <>
      <TimelineHeader
        board={board}
        modalBoards={modalBoards}
        modalTeams={modalTeams}
        handleBoardNavigate={handleBoardNavigate}
        showBoardMenu={showBoardMenu}
        setShowBoardMenu={setShowBoardMenu}
        boardMenuRef={boardMenuRef}
        setShowNotificationSettings={setShowNotificationSettings}
        onOpenNotificationsPanel={onOpenNotificationsPanel}
        setShowProfileSettings={setShowProfileSettings}
        onOpenBoardSettings={onOpenBoardSettings}
        onOpenTeamSettings={onOpenTeamSettings}
        profile={profile}
        user={user}
        signOut={signOut}
        dayRange={dayRange}
        onDayRangeChange={onDayRangeChange}
        onTodayClick={onTodayClick}
        googleStatusText={googleStatusText}
        googleCalendarStatus={googleCalendarStatus}
        googleCalendarError={googleCalendarError}
        googleCalendars={googleCalendars}
        selectedGoogleCalendarIds={selectedGoogleCalendarIds}
        googleCalendarPartialErrors={googleCalendarPartialErrors}
        googleCalendarSelectionStatus={googleCalendarSelectionStatus}
        updateGoogleCalendarSelection={updateGoogleCalendarSelection}
        calendarPreset={calendarPreset}
        setCalendarPreset={setCalendarPreset}
        refreshGoogleCalendar={refreshGoogleCalendar}
        handleGoogleConnect={handleGoogleConnect}
        isGoogleLoading={isGoogleLoading}
        realtimeStatus={realtimeStatus}
        viewMode={viewMode}
        onShortcutsClick={onShortcutsClick}
        collapsed={collapsed}
      />
      {googleToast && (
        <div className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white shadow-md">
          {googleToast}
        </div>
      )}
    </>
  );
}
