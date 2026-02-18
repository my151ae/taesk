import { redirect } from "next/navigation";
import { getBoardById } from "@/lib/server/boards";
import { buildBoardUrl } from "@/lib/board-url";
import { createServerSupabaseClient, type Board } from "@/lib/supabase";
import { isAdminUser } from "@/lib/admins";
import { createServiceRoleSupabaseClient } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const revalidate = 0;

export default async function BoardDefaultPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  if (isAdminUser({ id: user.id, email: user.email })) {
    const adminSupabase = createServiceRoleSupabaseClient();
    const { data: adminBoards, error: adminBoardsError } = await adminSupabase
      .from('boards')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1);

    if (adminBoardsError) {
      console.error("[board-default] failed to fetch boards for admin", adminBoardsError);
    } else if (adminBoards && adminBoards.length > 0) {
      const adminBoard = adminBoards[0] as Board;
      const adminCanonicalUrl = buildBoardUrl(adminBoard);
      if (adminCanonicalUrl) {
        redirect(adminCanonicalUrl);
      }
      if (adminBoard.short_id) {
        redirect(`/b/${adminBoard.short_id}`);
      }
    }
  }

  // ユーザーが所属しているボードを最大20件取得（古い順）
  const { data: memberships } = await supabase
    .from('board_members')
    .select('board_id')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: true })
    .limit(20);

  const membershipBoardIds = (memberships ?? [])
    .map((row) => row.board_id)
    .filter((value): value is string => Boolean(value));

  const boardCandidateIds = Array.from(new Set(membershipBoardIds));

  let board = null;
  for (const boardId of boardCandidateIds) {
    board = await getBoardById(boardId);
    if (board) break;
  }

  if (!board) {
    redirect("/playground");
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
