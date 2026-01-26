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

  // ユーザーが所属しているボードを1つ取得
  const { data: membership } = await supabase
    .from('board_members')
    .select('board_id')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  let targetBoardId = MAIN_BOARD_ID;
  if (membership) {
    targetBoardId = membership.board_id;
  }

  const board = await getBoardById(targetBoardId);

  if (!board) {
    // ボードが1つもない場合は、ログイン直後の画面などへ飛ばすか、エラーを表示
    throw new Error("No boards found for user");
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
