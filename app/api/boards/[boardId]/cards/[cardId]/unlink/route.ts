import { NextRequest, NextResponse } from "next/server";

import { authorizeBoardMutation } from "@/lib/server/board-request";
import { withErrorHandling } from "@/lib/server/with-error-handling";

const postHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> }
) => {
  const { boardId, cardId } = await params;
  const auth = await authorizeBoardMutation(request, boardId);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.data;

  const { data: childCard, error: fetchError } = await supabase
    .from("cards")
    .select("id, board_id, parent_card_id, is_parent, deleted_at")
    .eq("id", cardId)
    .eq("board_id", boardId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: fetchError.message } },
      { status: 500 }
    );
  }
  if (!childCard || childCard.deleted_at) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Card not found" } },
      { status: 404 }
    );
  }
  if (!childCard.parent_card_id) {
    return NextResponse.json({ card: childCard }, { status: 200 });
  }
  if (childCard.is_parent) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "child card invariant violated" } },
      { status: 409 }
    );
  }

  const { data: updatedCard, error: updateError } = await supabase
    .from("cards")
    .update({
      parent_card_id: null,
      is_parent: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cardId)
    .eq("board_id", boardId)
    .select("*")
    .single();

  if (updateError || !updatedCard) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: updateError?.message ?? "Failed to unlink card" } },
      { status: 500 }
    );
  }

  return NextResponse.json({ card: updatedCard }, { status: 200 });
};

export const POST = withErrorHandling(postHandler, "cards-unlink-post");
