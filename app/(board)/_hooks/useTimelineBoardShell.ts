"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import type { Board, ProfileSummary, TeamView } from "@/lib/supabase";
import { buildBoardUrl } from "@/lib/board-url";
import type { BoardMember } from "@/app/(board)/_stores/board-members-store";

type ProfileResponse = ProfileSummary | null;
const LAST_BOARD_COOKIE = "taesk-last-board-id";

type UseTimelineBoardShellProps = {
  initialBoard: Board;
  currentBoardId: string;
  userId?: string;
  router: AppRouterInstance;
  onTimelineStartHour?: (hour: number) => void;
  setBoardMembers: (members: BoardMember[]) => void;
  setStoredMembers: (boardId: string, members: BoardMember[]) => void;
};

export function useTimelineBoardShell({
  initialBoard,
  currentBoardId,
  userId,
  router,
  onTimelineStartHour,
  setBoardMembers,
  setStoredMembers,
}: UseTimelineBoardShellProps) {
  const [profile, setProfile] = useState<ProfileResponse>(null);
  const [availableBoards, setAvailableBoards] = useState<Board[]>([initialBoard]);
  const [availableTeams, setAvailableTeams] = useState<TeamView[]>([]);

  const fetchProfile = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch("/api/profiles");
      if (!response.ok) return;
      const data = (await response.json()) as ProfileResponse;
      setProfile(data);
      const hour = data?.timeline_start_hour;
      if (typeof hour === "number") {
        onTimelineStartHour?.(hour);
      }
    } catch (error) {
      console.error("[timeline-shell] failed to fetch profile", error);
    }
  }, [onTimelineStartHour, userId]);

  const fetchBoards = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch("/api/boards");
      if (!response.ok) return;
      const body = (await response.json()) as { boards?: Board[] };
      setAvailableBoards(body.boards || []);
    } catch (error) {
      console.error("[timeline-shell] failed to fetch boards", error);
    }
  }, [userId]);

  const fetchTeams = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch("/api/teams");
      if (!response.ok) return;
      const body = (await response.json()) as { teams?: TeamView[] };
      setAvailableTeams(body.teams || []);
    } catch (error) {
      console.error("[timeline-shell] failed to fetch teams", error);
    }
  }, [userId]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    void fetchBoards();
  }, [fetchBoards]);

  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  useEffect(() => {
    if (!currentBoardId) return;
    document.cookie = `${LAST_BOARD_COOKIE}=${currentBoardId}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  }, [currentBoardId]);

  const refreshBoardMembers = useCallback(async () => {
    if (!currentBoardId) return;
    try {
      const response = await fetch(`/api/boards/${currentBoardId}/members`);
      if (!response.ok) {
        console.warn("[timeline-shell] failed to refresh board members", { status: response.status });
        return;
      }
      const body = (await response.json()) as {
        members?: Array<{ profile: BoardMember["profile"]; role: BoardMember["role"] }>;
      };
      const nextMembers: BoardMember[] = (body.members || []).map((m) => ({
        profile: m.profile,
        role: m.role,
      }));
      setBoardMembers(nextMembers);
      setStoredMembers(currentBoardId, nextMembers);
    } catch (error) {
      console.error("[timeline-shell] failed to refresh board members", error);
    }
  }, [currentBoardId, setBoardMembers, setStoredMembers]);

  const handleBoardNavigate = useCallback(
    (board: Board) => {
      const target = buildBoardUrl(board);
      router.push(target || `/b/${board.short_id}` || `/board?boardId=${board.id}`);
    },
    [router]
  );

  const handleUpdateBoard = useCallback(
    async (updates: Partial<Board>) => {
      try {
        const response = await fetch(`/api/boards/${currentBoardId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message || "Failed to update board");
        }
        const { board: updatedBoard } = (await response.json()) as { board: Board };
        setAvailableBoards((prev) =>
          prev.map((b) => (b.id === updatedBoard.id ? updatedBoard : b))
        );
      } catch (error) {
        console.error("[timeline-shell] failed to update board", error);
        alert(error instanceof Error ? error.message : "Failed to update board");
      }
    },
    [currentBoardId]
  );

  return {
    profile,
    availableBoards,
    availableTeams,
    setAvailableBoards,
    fetchProfile,
    refreshBoardMembers,
    handleBoardNavigate,
    handleUpdateBoard,
  };
}
