import { NextResponse } from 'next/server';

export const ApiErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_ORIGIN: 'INVALID_ORIGIN',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_BODY: 'INVALID_BODY',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  TEAM_MEMBERSHIP_REQUIRED: 'TEAM_MEMBERSHIP_REQUIRED',
  LAST_BOARD_OWNER_TRANSFER_REQUIRED: 'LAST_BOARD_OWNER_TRANSFER_REQUIRED',
  DB_ERROR: 'DB_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    },
    { status }
  );
}
