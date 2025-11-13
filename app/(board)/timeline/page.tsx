import TimelineBoardPage from "../_components/timeline/TimelineBoardPage";
import { getBoardById } from "@/lib/server/boards";
import { MAIN_BOARD_ID } from "@/lib/board-defaults";

export const runtime = "nodejs";
export const revalidate = 0;

export default async function TimelinePage() {
  const board = await getBoardById(MAIN_BOARD_ID);

  if (!board) {
    throw new Error("Main board not found");
  }

  return <TimelineBoardPage initialBoard={board} />;
}
