import { NextRequest, NextResponse } from "next/server";

import { authorizeBoardMutation } from "@/lib/server/board-request";
import { withErrorHandling } from "@/lib/server/with-error-handling";
import { logCardActivity } from "@/lib/server/card-side-effects";

const postHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> }
) => {
  const { boardId, cardId } = await params;
  const auth = await authorizeBoardMutation(request, boardId);
  if (!auth.ok) {
    return auth.response;
  }

  const { supabase, user } = auth.data;
  const { data: card, error } = await supabase
    .from("cards")
    .update({
      deleted_at: null,
      purge_after_at: null,
    })
    .eq("id", cardId)
    .eq("board_id", boardId)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  if (!card) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Card not found" } },
      { status: 404 },
    );
  }

  logCardActivity(supabase, {
    boardId,
    userId: user.id,
    action: "restored",
    cardId,
    cardTitle: card.title ?? null,
  });

  return NextResponse.json({ card }, { status: 200 });
};

export const POST = withErrorHandling(postHandler, "cards-restore");
