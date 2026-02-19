"use client";

import type { Dispatch, SetStateAction } from "react";
import type { Board } from "@/lib/supabase";
import ShareDialog from "@/app/(board)/_components/ShareDialog";
import NotificationSettings from "@/app/(board)/_components/NotificationSettings";
import ProfileSettings from "@/app/(board)/_components/ProfileSettings";
import BoardSettings from "@/app/(board)/_components/BoardSettings";
import TeamManagementDialog from "@/app/(board)/_components/TeamManagementDialog";

type TimelineBoardDialogsProps = {
  showShareDialog: boolean;
  setShowShareDialog: (show: boolean) => void;
  showNotificationSettings: boolean;
  setShowNotificationSettings: (show: boolean) => void;
  showProfileSettings: boolean;
  setShowProfileSettings: (show: boolean) => void;
  showBoardSettings: boolean;
  setShowBoardSettings: (show: boolean) => void;
  showTeamSettings: boolean;
  setShowTeamSettings: (show: boolean) => void;
  teamSettingsTeamId?: string | null;
  initialBoard: Board;
  fetchProfile: () => Promise<void>;
  setAvailableBoards: Dispatch<SetStateAction<Board[]>>;
  setActiveDayIndex: (value: number) => void;
  fetchTimeline: (start?: number) => Promise<unknown>;
  onMemberAdded?: () => void | Promise<void>;
};

export default function TimelineBoardDialogs({
  showShareDialog,
  setShowShareDialog,
  showNotificationSettings,
  setShowNotificationSettings,
  showProfileSettings,
  setShowProfileSettings,
  showBoardSettings,
  setShowBoardSettings,
  showTeamSettings,
  setShowTeamSettings,
  teamSettingsTeamId,
  initialBoard,
  fetchProfile,
  setAvailableBoards,
  setActiveDayIndex,
  fetchTimeline,
  onMemberAdded,
}: TimelineBoardDialogsProps) {
  return (
    <>
      {showShareDialog && (
        <ShareDialog
          boardId={initialBoard.id}
          onClose={() => setShowShareDialog(false)}
          onMemberAdded={onMemberAdded}
        />
      )}

      {showNotificationSettings && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
          onClick={() => setShowNotificationSettings(false)}
        >
          <div
            className="my-6 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Notification Settings</h2>
              <button
                onClick={() => setShowNotificationSettings(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto pr-1">
              <NotificationSettings />
            </div>
          </div>
        </div>
      )}

      {showProfileSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowProfileSettings(false)}
        >
          <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Profile Settings</h2>
              <button
                onClick={() => setShowProfileSettings(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <ProfileSettings onProfileUpdated={() => {
              // Reload the page to reflect all setting changes immediately
              window.location.reload();
            }} />
          </div>
        </div>
      )}

      {showBoardSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowBoardSettings(false)}
        >
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Board Settings</h2>
              <button
                onClick={() => setShowBoardSettings(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <BoardSettings
              board={initialBoard}
              onUpdate={async (updates) => {
                try {
                  const response = await fetch(`/api/boards/${initialBoard.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(updates),
                  });
                  if (!response.ok) throw new Error("Failed to update board");
                  const { board: updatedBoard } = await response.json();

                  Object.assign(initialBoard, updatedBoard);

                  setAvailableBoards((prev) =>
                    prev.map((board) => (board.id === updatedBoard.id ? updatedBoard : board)),
                  );

                  setShowBoardSettings(false);
                  setActiveDayIndex(0);
                  await fetchTimeline();
                } catch (error) {
                  console.error("Failed to update board", error);
                  alert("Failed to update board");
                }
              }}
            />
          </div>
        </div>
      )}

      {showTeamSettings && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
          onClick={() => setShowTeamSettings(false)}
        >
          <div
            className="my-6 flex max-h-[90vh] w-full max-w-6xl flex-col rounded-xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Team Management</h2>
              <button
                onClick={() => setShowTeamSettings(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto pr-1">
              <TeamManagementDialog initialTeamId={teamSettingsTeamId ?? initialBoard.team_id ?? null} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
