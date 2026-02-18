"use client";

import { useMemo } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import type { Board } from "@/lib/supabase";
import { useBoardMembers } from "@/app/(board)/_hooks/useBoardMembers";
import { useBoardMembersStore } from "@/app/(board)/_stores/board-members-store";
import { useTimelineBoardShell } from "@/app/(board)/_hooks/useTimelineBoardShell";

type UseTimelineBoardInitializationArgs = {
  initialBoard: Board;
  currentBoardId: string;
  userId?: string;
  router: AppRouterInstance;
  onTimelineStartHour: (hour: number) => void;
};

export function useTimelineBoardInitialization({
  initialBoard,
  currentBoardId,
  userId,
  router,
  onTimelineStartHour,
}: UseTimelineBoardInitializationArgs) {
  const { boardMembers, setBoardMembers } = useBoardMembers(initialBoard.id);
  const { setMembers: setStoredMembers } = useBoardMembersStore();

  const shell = useTimelineBoardShell({
    initialBoard,
    currentBoardId,
    userId,
    router,
    onTimelineStartHour,
    setBoardMembers,
    setStoredMembers,
  });

  const currentBoard = useMemo(
    () => shell.availableBoards.find((board) => board.id === currentBoardId) || initialBoard,
    [currentBoardId, initialBoard, shell.availableBoards]
  );

  return {
    boardMembers,
    currentBoard,
    ...shell,
  };
}
