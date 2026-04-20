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

  const { data: parentCard, error: fetchError } = await supabase
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
  if (!parentCard || parentCard.deleted_at) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Card not found" } },
      { status: 404 }
    );
  }
  if (parentCard.parent_card_id) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "child card cannot be unparented" } },
      { status: 409 }
    );
  }

  const { count: childCount } = await supabase
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("board_id", boardId)
    .eq("parent_card_id", cardId)
    .is("deleted_at", null);

  if ((childCount ?? 0) > 0) {
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "parent card still has children" } },
      { status: 409 }
    );
  }

  const { data: updatedCard, error: updateError } = await supabase
    .from("cards")
    .update({
      is_parent: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cardId)
    .eq("board_id", boardId)
    .is("deleted_at", null)
    .select("*")
    .single();

  if (updateError || !updatedCard) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: updateError?.message ?? "Failed to unparent card" } },
      { status: 500 }
    );
  }

  return NextResponse.json({ card: updatedCard }, { status: 200 });
};

export const POST = withErrorHandling(postHandler, "cards-unparent-post");
