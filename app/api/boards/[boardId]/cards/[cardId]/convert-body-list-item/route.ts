import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeBoardMutation } from "@/lib/server/board-request";
import { withErrorHandling } from "@/lib/server/with-error-handling";
import {
  buildDefaultBodyContent,
  deriveExcerptFromContent,
  normalizeContent,
} from "@/lib/tiptap";
import { generateShortId, slugify } from "@/lib/card-utils";

const postSchema = z.object({
  title: z.string().trim().min(1).max(255),
  child_content: z.unknown(),
  parent_content: z.unknown(),
});

const postHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> }
) => {
  const { boardId, cardId } = await params;
  const auth = await authorizeBoardMutation(request, boardId);
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth.data;

  const body = await request.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid payload" } },
      { status: 400 }
    );
  }

  const { data: parentCard, error: parentFetchError } = await supabase
    .from("cards")
    .select("id, board_id, list_id, parent_card_id, due_date, due_bucket, updated_at")
    .eq("id", cardId)
    .eq("board_id", boardId)
    .is("deleted_at", null)
    .maybeSingle();

  if (parentFetchError) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: parentFetchError.message } },
      { status: 500 }
    );
  }

  if (!parentCard || parentCard.parent_card_id) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Parent card not found" } },
      { status: 404 }
    );
  }

  const childContent = normalizeContent(parsed.data.child_content) ?? buildDefaultBodyContent();
  const parentContent = normalizeContent(parsed.data.parent_content);
  const parentExcerpt = deriveExcerptFromContent(parentContent);
  const childExcerpt = deriveExcerptFromContent(childContent);

  const { data: maxIdShortData } = await supabase
    .from("cards")
    .select("id_short")
    .eq("board_id", boardId)
    .order("id_short", { ascending: false })
    .limit(1)
    .maybeSingle();
  const idShort = (maxIdShortData?.id_short ?? 0) + 1;

  const { data: maxPositionData } = await supabase
    .from("cards")
    .select("position")
    .eq("board_id", boardId)
    .eq("list_id", parentCard.list_id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (maxPositionData?.position ?? 0) + 1024;

  const now = new Date().toISOString();
  const { data: childCard, error: childCreateError } = await supabase
    .from("cards")
    .insert({
      board_id: boardId,
      list_id: parentCard.list_id,
      parent_card_id: cardId,
      is_parent: false,
      title: parsed.data.title,
      checklist: { version: 1, lines: [] },
      content: childContent,
      excerpt: childExcerpt,
      tags: [],
      due_date: parentCard.due_date ?? null,
      due_start: null,
      due_end: null,
      due_bucket: parentCard.due_bucket ?? null,
      due_bucket_position: null,
      checked: false,
      checked_at: null,
      assignee_id: null,
      assigned_to: null,
      short_id: generateShortId(),
      id_short: idShort,
      slug: slugify(parsed.data.title),
      user_id: user.id,
      position,
      created_at: now,
      updated_at: now,
      duration: 60,
    })
    .select("*")
    .single();

  if (childCreateError || !childCard) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: childCreateError?.message ?? "Failed to create child card" } },
      { status: 500 }
    );
  }

  const parentUpdate = {
    content: parentContent,
    excerpt: parentExcerpt,
    is_parent: true,
    updated_at: new Date().toISOString(),
  };
  const parentUpdateQuery = supabase
    .from("cards")
    .update(parentUpdate)
    .eq("id", cardId)
    .eq("board_id", boardId)
    .is("deleted_at", null);

  const { data: updatedParent, error: parentUpdateError } = await parentUpdateQuery
    .select("*")
    .maybeSingle();

  if (parentUpdateError || !updatedParent) {
    const deletedAt = new Date().toISOString();
    const purgeAfterAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("cards")
      .update({ deleted_at: deletedAt, purge_after_at: purgeAfterAt })
      .eq("id", childCard.id)
      .eq("board_id", boardId);

    return NextResponse.json(
      { error: { code: "CONFLICT", message: "Card was updated. Please retry." } },
      { status: 409 }
    );
  }

  return NextResponse.json({ card: childCard, parent: updatedParent }, { status: 201 });
};

export const POST = withErrorHandling(postHandler, "cards-convert-body-list-item-post");
