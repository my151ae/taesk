import { NextRequest, NextResponse } from "next/server";

import { withErrorHandling } from "@/lib/server/with-error-handling";
import { createServiceRoleSupabaseClient } from "@/lib/server/supabaseAdmin";
import { deleteCardFromCalendarBestEffort, logCardActivity } from "@/lib/server/card-side-effects";
import { CARD_IMAGE_BUCKET, buildCardImageStoragePrefix } from "@/lib/tiptap-images";

const STORAGE_LIST_PAGE_SIZE = 100;

const deleteCardImagesBestEffort = async (boardId: string, cardId: string) => {
  const admin = createServiceRoleSupabaseClient();
  const prefix = buildCardImageStoragePrefix(boardId, cardId);
  const targetPaths: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await admin.storage.from(CARD_IMAGE_BUCKET).list(prefix, {
      limit: STORAGE_LIST_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error || !data?.length) break;

    for (const item of data) {
      if (item?.name) {
        targetPaths.push(`${prefix}${item.name}`);
      }
    }

    if (data.length < STORAGE_LIST_PAGE_SIZE) break;
    offset += data.length;
  }

  for (let i = 0; i < targetPaths.length; i += STORAGE_LIST_PAGE_SIZE) {
    const chunk = targetPaths.slice(i, i + STORAGE_LIST_PAGE_SIZE);
    if (!chunk.length) continue;
    const { error } = await admin.storage.from(CARD_IMAGE_BUCKET).remove(chunk);
    if (error) {
      console.warn("[trash purge] failed to remove card images", { boardId, cardId, error });
    }
  }
};

const postHandler = async (request: NextRequest) => {
  const suppliedSecret = request.headers.get("x-cron-secret") ?? "";
  const expectedSecret = process.env.CRON_SECRET ?? "";
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Invalid cron secret" } },
      { status: 403 },
    );
  }

  const supabase = createServiceRoleSupabaseClient();
  const { data: cards, error } = await supabase
    .from("cards")
    .select("id, board_id, title, user_id")
    .not("deleted_at", "is", null)
    .not("purge_after_at", "is", null)
    .lte("purge_after_at", new Date().toISOString())
    .limit(200);

  if (error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  let purged = 0;

  for (const card of cards ?? []) {
    if (card.user_id) {
      await deleteCardFromCalendarBestEffort(supabase, card.user_id, card.id);
    }

    await deleteCardImagesBestEffort(card.board_id, card.id);

    const { error: deleteError } = await supabase
      .from("cards")
      .delete()
      .eq("id", card.id)
      .eq("board_id", card.board_id);

    if (deleteError) {
      console.warn("[trash purge] failed to delete card", { cardId: card.id, error: deleteError });
      continue;
    }

    purged += 1;
    if (card.user_id) {
      logCardActivity(supabase, {
        boardId: card.board_id,
        userId: card.user_id,
        action: "deleted",
        cardId: card.id,
        cardTitle: card.title ?? null,
      });
    }
  }

  return NextResponse.json({ purged }, { status: 200 });
};

export const POST = withErrorHandling(postHandler, "internal-trash-purge");
