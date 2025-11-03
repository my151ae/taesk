import { permanentRedirect } from "next/navigation";

import KanbanBoardClient from "./_components/KanbanBoardClient";
import { buildBoardUrl } from "@/lib/board-url";
import { getBoardById } from "@/lib/server/boards";
import { MAIN_BOARD_ID } from "@/lib/board-defaults";

export const runtime = "nodejs";
export const revalidate = 0;

export default async function BoardPage() {
  let board = null;

  try {
    board = await getBoardById(MAIN_BOARD_ID);
  } catch (error) {
    // If MAIN_BOARD_ID doesn't exist, board will be null
    // KanbanBoardClient will handle creating/loading a board
    console.error('[BoardPage] Error fetching MAIN_BOARD_ID:', error);
  }

  const canonical = board ? buildBoardUrl(board) : "";

  if (canonical) {
    permanentRedirect(canonical);
  }

  return <KanbanBoardClient initialBoard={board} />;
}
