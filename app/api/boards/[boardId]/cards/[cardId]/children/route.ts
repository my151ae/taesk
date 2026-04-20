import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { withErrorHandling } from "@/lib/server/with-error-handling";
import { authorizeBoardMutation } from "@/lib/server/board-request";
import { createServerSupabaseClient } from "@/lib/supabase";
import { getBoardMembership, requireAuthenticatedUser } from "@/lib/server/api-security";
import { buildDefaultBodyContent } from "@/lib/tiptap";
import { generateShortId, slugify } from "@/lib/card-utils";

type ChildCardRow = {
  id: string;
  short_id: string | null;
  title: string;
  due_date: string | null;
  due_start: string | null;
  due_bucket: "a" | "b" | null;
  created_at: string;
};

const postSchema = z.object({
  title: z.string().max(255).optional(),
});

const getHandler = async (
  _request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> }
) => {
  const { boardId, cardId } = await params;
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) return errorResponse;

  const membership = await getBoardMembership(supabase, boardId, user.id);
  if (!membership) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Not a board member" } },
      { status: 403 }
    );
  }

  const { data: parentCard } = await supabase
    .from("cards")
    .select("id, board_id, parent_card_id")
    .eq("id", cardId)
    .eq("board_id", boardId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!parentCard || parentCard.parent_card_id) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Parent card not found" } },
      { status: 404 }
    );
  }

  const { data: children, error } = await supabase
    .from("cards")
    .select("id, short_id, title, due_date, due_start, due_bucket, created_at")
    .eq("board_id", boardId)
    .eq("parent_card_id", cardId)
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("due_bucket", { ascending: true, nullsFirst: false })
    .order("due_start", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({ children: (children ?? []) as ChildCardRow[] }, { status: 200 });
};

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

  const { data: parentCard, error: parentError } = await supabase
    .from("cards")
    .select("id, board_id, parent_card_id, is_parent, due_date, due_bucket")
    .eq("id", cardId)
    .eq("board_id", boardId)
    .is("deleted_at", null)
    .maybeSingle();

  if (parentError) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: parentError.message } },
      { status: 500 }
    );
  }

  if (!parentCard || parentCard.parent_card_id) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Parent card not found" } },
      { status: 404 }
    );
  }

  if (!parentCard.is_parent) {
    const { error: parentPromoteError } = await supabase
      .from("cards")
      .update({ is_parent: true })
      .eq("id", cardId)
      .eq("board_id", boardId)
      .is("deleted_at", null);
    if (parentPromoteError) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: parentPromoteError.message } },
        { status: 500 }
      );
    }
  }

  const now = new Date().toISOString();
  const { data: firstList, error: listError } = await supabase
    .from("lists")
    .select("id")
    .eq("board_id", boardId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (listError || !firstList?.id) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: listError?.message ?? "List not found" } },
      { status: 500 }
    );
  }

  const { data: maxIdShortData } = await supabase
    .from("cards")
    .select("id_short")
    .eq("board_id", boardId)
    .order("id_short", { ascending: false })
    .limit(1)
    .maybeSingle();
  const idShort = (maxIdShortData?.id_short ?? 0) + 1;

  const childTitle = parsed.data.title ?? "";
  const { data: createdCard, error: createError } = await supabase
    .from("cards")
    .insert({
      board_id: boardId,
      list_id: firstList.id,
      parent_card_id: cardId,
      is_parent: false,
      title: childTitle,
      checklist: { version: 1, lines: [] },
      content: buildDefaultBodyContent(),
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
      slug: slugify(childTitle || "child"),
      user_id: user.id,
      created_at: now,
      updated_at: now,
      duration: 60,
    })
    .select("*")
    .single();

  if (createError || !createdCard) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: createError?.message ?? "Failed to create child card" } },
      { status: 500 }
    );
  }

  return NextResponse.json({ card: createdCard }, { status: 201 });
};

export const GET = withErrorHandling(getHandler, "cards-children-get");
export const POST = withErrorHandling(postHandler, "cards-children-post");
