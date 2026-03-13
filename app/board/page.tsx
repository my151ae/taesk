import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getBoardById } from "@/lib/server/boards";
import { buildBoardUrl } from "@/lib/board-url";
import { createServerSupabaseClient } from "@/lib/supabase";
import { ensureDefaultTeamAndBoard } from "@/lib/server/personal-workspace";

export const runtime = "nodejs";
export const revalidate = 0;
const LAST_BOARD_COOKIE = "taesk-last-board-id";

export default async function BoardDefaultPage() {
  const supabase = await createServerSupabaseClient();
  const cookieStore = await cookies();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const lastBoardId = cookieStore.get(LAST_BOARD_COOKIE)?.value ?? null;

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

  let ensuredBoardId: string | null = null;
  if (membershipBoardIds.length === 0) {
    const ensured = await ensureDefaultTeamAndBoard(user);
    ensuredBoardId = ensured.boardId;
  }

  const boardCandidateIds = Array.from(new Set([
    ...(lastBoardId ? [lastBoardId] : []),
    ...membershipBoardIds,
    ...(ensuredBoardId ? [ensuredBoardId] : []),
  ]));

  let board = null;
  for (const boardId of boardCandidateIds) {
    board = await getBoardById(boardId);
    if (board) break;
  }

  if (!board) {
    const ensuredBoard = ensuredBoardId ? await getBoardById(ensuredBoardId) : null;
    if (ensuredBoard) {
      board = ensuredBoard;
    } else {
      redirect("/playground");
    }
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
