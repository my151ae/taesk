import { redirect } from "next/navigation";
import { getBoardById } from "@/lib/server/boards";
import { buildBoardUrl } from "@/lib/board-url";
import { MAIN_BOARD_ID } from "@/lib/board-defaults";
import { createServerSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const revalidate = 0;

export default async function BoardDefaultPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const board = await getBoardById(MAIN_BOARD_ID);

  if (!board) {
    throw new Error("Main board not found");
  }

  // Redirect to canonical URL
  const canonicalUrl = buildBoardUrl(board);
  if (canonicalUrl) {
    redirect(canonicalUrl);
  }

  // Fallback to short_id only URL if canonical URL can't be built
  if (board.short_id) {
    redirect(`/b/${board.short_id}`);
  }

  throw new Error("Board has no short_id");
}
