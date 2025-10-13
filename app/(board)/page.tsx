import { permanentRedirect } from "next/navigation";

import KanbanBoardClient from "./_components/KanbanBoardClient";
import { buildBoardUrl } from "@/lib/board-url";
import { getBoardById } from "@/lib/server/boards";
import { MAIN_BOARD_ID } from "@/lib/board-defaults";

export const runtime = "nodejs";
export const revalidate = 0;

export default async function BoardPage() {
  const board = await getBoardById(MAIN_BOARD_ID);

  const canonical = board ? buildBoardUrl(board) : "";

  if (canonical) {
    permanentRedirect(canonical);
  }

  return <KanbanBoardClient initialBoard={board} />;
}
