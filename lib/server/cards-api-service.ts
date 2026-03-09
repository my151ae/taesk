import { errorResponse, ApiErrorCode } from "@/lib/server/api-error";
import {
  isMissingColumnError,
  missingCardColumnResponse,
} from "@/lib/server/card-mutation";

const CARD_CREATE_FALLBACK_COLUMNS = ["due_bucket_position"] as const;
const CARD_UPDATE_FALLBACK_COLUMNS = ["due_bucket_position", "assignee_ids"] as const;

export function getCardCreateFallbackColumns(): string[] {
  return [...CARD_CREATE_FALLBACK_COLUMNS];
}

export function getCardUpdateFallbackColumns(): string[] {
  return [...CARD_UPDATE_FALLBACK_COLUMNS];
}

export function validationFailedResponse(details: unknown) {
  return errorResponse(ApiErrorCode.INVALID_BODY, "Validation failed", 422, details);
}

export function cardMutationErrorResponse(args: {
  error: { code?: string; message?: string } | null;
  payload: Record<string, unknown>;
}) {
  const { error, payload } = args;

  if (isMissingColumnError(error, "checklist") && "checklist" in payload) {
    const response = missingCardColumnResponse("checklist");
    if (response) return response;
  }

  if (isMissingColumnError(error, "content") && "content" in payload) {
    const response = missingCardColumnResponse("content");
    if (response) return response;
  }

  if (error) {
    return errorResponse(ApiErrorCode.DB_ERROR, error.message ?? "Database error", 500);
  }

  return null;
}

export function cardInsertResultMissingResponse() {
  return errorResponse(
    ApiErrorCode.INTERNAL_ERROR,
    "Card was not returned after insert",
    500
  );
}
