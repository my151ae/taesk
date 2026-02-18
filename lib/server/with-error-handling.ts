import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, ApiErrorCode } from '@/lib/server/api-error';

type RouteContext<TParams> = { params: Promise<TParams> };

type RouteHandlerWithParams<TParams = Record<string, string>> = (
  request: NextRequest,
  context: RouteContext<TParams>
) => Promise<Response | NextResponse>;

type RouteHandlerWithoutParams = (
  request: NextRequest
) => Promise<Response | NextResponse>;

type RouteHandler<TParams = Record<string, string>> =
  | RouteHandlerWithoutParams
  | RouteHandlerWithParams<TParams>;

export function withErrorHandling<TParams = Record<string, string>>(
  handler: RouteHandler<TParams>,
  label: string
): (
  request: NextRequest,
  context?: RouteContext<TParams>
) => Promise<Response | NextResponse> {
  return async (request, context) => {
    try {
      if (context) {
        return await (handler as RouteHandlerWithParams<TParams>)(request, context);
      }
      return await (handler as RouteHandlerWithoutParams)(request);
    } catch (error) {
      console.error(`[${label}] unexpected error`, error);
      return errorResponse(ApiErrorCode.INTERNAL_ERROR, 'Internal server error', 500);
    }
  };
}
