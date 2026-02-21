import { NextRequest, NextResponse } from "next/server";

import { withErrorHandling } from "@/lib/server/with-error-handling";
import { authorizeBoardMutation } from "@/lib/server/board-request";
import { ApiErrorCode, errorResponse } from "@/lib/server/api-error";
import { createServiceRoleSupabaseClient } from "@/lib/server/supabaseAdmin";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  CARD_IMAGE_BUCKET,
  CARD_IMAGE_MAX_BYTES,
  CARD_IMAGE_SIGNED_URL_EXPIRES_IN_SECONDS,
  cardImageExtensionFromMimeType,
  isSupportedCardImageMimeType,
  buildCardImageStoragePrefix,
  CARD_IMAGE_ALLOWED_MIME_TYPES,
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

async function ensureCardImageBucket() {
  const admin = createServiceRoleSupabaseClient();
  const { error } = await admin.storage.createBucket(CARD_IMAGE_BUCKET, {
    public: false,
    fileSizeLimit: CARD_IMAGE_MAX_BYTES,
    allowedMimeTypes: [...CARD_IMAGE_ALLOWED_MIME_TYPES],
  });

  if (!error) return null;
  if (error.message.includes("already exists")) return null;
  return error.message;
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

  const formData = await request.formData();
  const fileValue = formData.get("file");

  if (!(fileValue instanceof File)) {
    return errorResponse(ApiErrorCode.INVALID_BODY, "file is required", 422);
  }

  const mimeType = fileValue.type.trim().toLowerCase();
  if (!isSupportedCardImageMimeType(mimeType)) {
    return errorResponse(
      ApiErrorCode.INVALID_BODY,
      "Only image/png, image/jpeg, image/webp are supported",
      415
    );
  }

  if (!Number.isFinite(fileValue.size) || fileValue.size <= 0) {
    return errorResponse(ApiErrorCode.INVALID_BODY, "file must not be empty", 422);
  }

  if (fileValue.size > CARD_IMAGE_MAX_BYTES) {
    return errorResponse(ApiErrorCode.INVALID_BODY, "file size exceeds 10MB", 413);
  }

  const extension = cardImageExtensionFromMimeType(mimeType);
  if (!extension) {
    return errorResponse(ApiErrorCode.INVALID_BODY, "unsupported mime type", 415);
  }

  const storagePath = `${buildCardImageStoragePrefix(boardId, cardId)}${crypto.randomUUID()}.${extension}`;

  const bucketError = await ensureCardImageBucket();
  if (bucketError) {
    return errorResponse(ApiErrorCode.DB_ERROR, bucketError, 500);
  }

  const admin = createServiceRoleSupabaseClient();
  const bytes = new Uint8Array(await fileValue.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from(CARD_IMAGE_BUCKET)
    .upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: false,
      cacheControl: "3600",
    });

  if (uploadError) {
    return errorResponse(ApiErrorCode.DB_ERROR, uploadError.message, 500);
  }

  const { data: signed, error: signedError } = await admin.storage
    .from(CARD_IMAGE_BUCKET)
    .createSignedUrl(storagePath, CARD_IMAGE_SIGNED_URL_EXPIRES_IN_SECONDS);

  if (signedError || !signed?.signedUrl) {
    await admin.storage.from(CARD_IMAGE_BUCKET).remove([storagePath]).catch(() => undefined);
    return errorResponse(
      ApiErrorCode.DB_ERROR,
      signedError?.message ?? "Failed to generate signed URL",
      500
    );
  }

  return NextResponse.json(
    {
      storagePath,
      signedUrl: signed.signedUrl,
      mimeType,
      size: fileValue.size,
    },
    { status: 201 }
  );
};

export const POST = withErrorHandling(postHandler, "card-images-post");
