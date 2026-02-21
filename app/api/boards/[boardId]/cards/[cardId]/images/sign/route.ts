import { NextRequest, NextResponse } from "next/server";

import { withErrorHandling } from "@/lib/server/with-error-handling";
import { authorizeBoardMutation } from "@/lib/server/board-request";
import { ApiErrorCode, errorResponse } from "@/lib/server/api-error";
import { createServiceRoleSupabaseClient } from "@/lib/server/supabaseAdmin";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  CARD_IMAGE_BUCKET,
  CARD_IMAGE_SIGNED_URL_EXPIRES_IN_SECONDS,
  CARD_IMAGE_SIGN_MAX_PATHS,
  CARD_IMAGE_MAX_PATH_LENGTH,
  buildCardImageStoragePrefix,
  isCardImagePathForCard,
} from "@/lib/tiptap-images";

export const runtime = "nodejs";

async function ensureCardInBoard(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  boardId: string,
  cardId: string
): Promise<boolean> {
  const { data: card, error } = await supabase
    .from("cards")
    .select("id")
    .eq("id", cardId)
    .eq("board_id", boardId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return !!card;
}

const postHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> }
) => {
  const { boardId, cardId } = await params;

  const auth = await authorizeBoardMutation(request, boardId, ["owner", "editor"]);
  if (!auth.ok) {
    return auth.response;
  }

  const cardExists = await ensureCardInBoard(auth.data.supabase, boardId, cardId);
  if (!cardExists) {
    return errorResponse(ApiErrorCode.NOT_FOUND, "Card not found", 404);
  }

  const body = await request.json().catch(() => null);
  const paths = Array.isArray(body?.paths) ? body.paths : null;
  if (!paths) {
    return errorResponse(ApiErrorCode.INVALID_BODY, "paths is required", 422);
  }

  if (paths.length > CARD_IMAGE_SIGN_MAX_PATHS) {
    return errorResponse(
      ApiErrorCode.INVALID_BODY,
      `paths must contain at most ${CARD_IMAGE_SIGN_MAX_PATHS} entries`,
      422
    );
  }

  const normalizedPaths: string[] = [];
  for (const value of paths) {
    if (typeof value !== "string") {
      return errorResponse(ApiErrorCode.INVALID_BODY, "paths must be string[]", 422);
    }
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.length > CARD_IMAGE_MAX_PATH_LENGTH) {
      return errorResponse(ApiErrorCode.INVALID_BODY, "path is too long", 422);
    }
    if (!isCardImagePathForCard(trimmed, boardId, cardId)) {
      return errorResponse(
        ApiErrorCode.FORBIDDEN,
        `path must start with ${buildCardImageStoragePrefix(boardId, cardId)}`,
        403
      );
    }
    normalizedPaths.push(trimmed);
  }

  if (normalizedPaths.length === 0) {
    return NextResponse.json({ urls: {} }, { status: 200 });
  }

  const admin = createServiceRoleSupabaseClient();
  const urls: Record<string, string> = {};

  for (const path of normalizedPaths) {
    const { data, error } = await admin.storage
      .from(CARD_IMAGE_BUCKET)
      .createSignedUrl(path, CARD_IMAGE_SIGNED_URL_EXPIRES_IN_SECONDS);

    if (error || !data?.signedUrl) {
      return errorResponse(
        ApiErrorCode.DB_ERROR,
        error?.message ?? `Failed to create signed URL: ${path}`,
        500
      );
    }

    urls[path] = data.signedUrl;
  }

  return NextResponse.json({ urls }, { status: 200 });
};

export const POST = withErrorHandling(postHandler, "card-images-sign-post");
