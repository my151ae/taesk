import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeBoardMutation } from "@/lib/server/board-request";
import { withErrorHandling } from "@/lib/server/with-error-handling";
import { normalizeChecklist } from "@/lib/checklist";
import { buildDefaultBodyContent, deriveExcerptFromContent, parseMarkdownToTiptapContent } from "@/lib/tiptap";
import { generateShortId, slugify } from "@/lib/card-utils";

const postSchema = z.object({
  target_line_id: z.string().min(1),
  card_updated_at: z.string().datetime(),
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
    .select("id, board_id, list_id, parent_card_id, is_parent, due_date, due_bucket, checklist, updated_at")
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
  if (parentCard.updated_at !== parsed.data.card_updated_at) {
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "Card was updated. Please retry." } },
      { status: 409 }
    );
  }

  const checklist = normalizeChecklist(parentCard.checklist);
  const startIndex = checklist.lines.findIndex((line) => line.id === parsed.data.target_line_id);
  if (startIndex < 0) {
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "Target checklist line no longer exists" } },
      { status: 409 }
    );
  }

  const startLine = checklist.lines[startIndex];
  const baseLevel = startLine.level;
  let endIndexExclusive = startIndex + 1;
  while (endIndexExclusive < checklist.lines.length) {
    if (checklist.lines[endIndexExclusive].level <= baseLevel) break;
    endIndexExclusive += 1;
  }

  const block = checklist.lines.slice(startIndex, endIndexExclusive);
  if (!block.length || !block[0]?.text?.trim()) {
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "Invalid checklist block" } },
      { status: 409 }
    );
  }

  const title = block[0].text.trim();
  const bodyMarkdown = block
    .slice(1)
    .map((line) => {
      const relativeIndent = Math.max(0, line.level - baseLevel - 1);
      const indent = "  ".repeat(relativeIndent);
      const mark = line.checked ? "[x]" : "[ ]";
      return `${indent}- ${mark} ${line.text}`;
    })
    .join("\n");
  const parsedBody = bodyMarkdown ? parseMarkdownToTiptapContent(bodyMarkdown) : null;
  const content = parsedBody ?? buildDefaultBodyContent();
  const excerpt = deriveExcerptFromContent(content);

  const { data: maxIdShortData } = await supabase
    .from("cards")
    .select("id_short")
    .eq("board_id", boardId)
    .order("id_short", { ascending: false })
    .limit(1)
    .maybeSingle();
  const idShort = (maxIdShortData?.id_short ?? 0) + 1;

  const now = new Date().toISOString();
  const { data: childCard, error: childCreateError } = await supabase
    .from("cards")
    .insert({
      board_id: boardId,
      list_id: parentCard.list_id,
      parent_card_id: cardId,
      is_parent: false,
      title,
      checklist: { version: 1, lines: [] },
      content,
      excerpt,
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
      slug: slugify(title),
      user_id: user.id,
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

  const remainingLines = [
    ...checklist.lines.slice(0, startIndex),
    ...checklist.lines.slice(endIndexExclusive),
  ];
  const nextChecklist = { ...checklist, lines: remainingLines };
  const { data: updatedParent, error: parentUpdateError } = await supabase
    .from("cards")
    .update({
      checklist: nextChecklist,
      is_parent: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cardId)
    .eq("board_id", boardId)
    .eq("updated_at", parsed.data.card_updated_at)
    .is("deleted_at", null)
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

export const POST = withErrorHandling(postHandler, "cards-convert-checklist-line-post");
