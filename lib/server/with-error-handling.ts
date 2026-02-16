import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, ApiErrorCode } from '@/lib/server/api-error';

type RouteHandler<TParams = Record<string, string>> = (
  request: NextRequest,
  context?: { params: Promise<TParams> }
) => Promise<Response | NextResponse>;

export function withErrorHandling<TParams = Record<string, string>>(
  handler: RouteHandler<TParams>,
  label: string
): RouteHandler<TParams> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      console.error(`[${label}] unexpected error`, error);
      return errorResponse(ApiErrorCode.INTERNAL_ERROR, 'Internal server error', 500);
    }
  };
}
