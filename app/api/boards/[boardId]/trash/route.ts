import { NextRequest, NextResponse } from "next/server";

import type { TrashResponse } from "@/lib/api-types/timeline";
import { withErrorHandling } from "@/lib/server/with-error-handling";
import { createServerSupabaseClient } from "@/lib/supabase";
import { getBoardMembership, requireAuthenticatedUser } from "@/lib/server/api-security";
import { mapCardRowToTrashItem, sortTrashItems } from "@/lib/server/trash";

const getHandler = async (
  _request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) => {
  const { boardId } = await params;
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);

  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Login required" } },
      { status: 401 },
    );
  }

  const membership = await getBoardMembership(supabase, boardId, user.id);
  if (!membership) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Not a board member" } },
      { status: 403 },
    );
  }

  const { data: cards, error } = await supabase
    .from("cards")
    .select("id, title, content, excerpt, due_date, due_start, due_end, checked, tags, assignee_id, assignee_ids, assigned_to, due_bucket, due_bucket_position, duration, short_id, slug, deleted_at, purge_after_at")
    .eq("board_id", boardId)
    .not("deleted_at", "is", null);

  if (error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  const items = sortTrashItems(
    (cards ?? [])
      .map((card) => mapCardRowToTrashItem(card))
      .filter((card): card is NonNullable<typeof card> => Boolean(card)),
  );

  const body: TrashResponse = { items };
  return NextResponse.json(body, { status: 200 });
};

export const GET = withErrorHandling(getHandler, "board-trash-get");
