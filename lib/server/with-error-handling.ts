import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, ApiErrorCode } from '@/lib/server/api-error';

type RouteContext<TParams> = { params: Promise<TParams> };

type RouteHandlerWithParams<TParams = Record<string, string>, TRequest extends Request = NextRequest> = (
  request: TRequest,
  context: RouteContext<TParams>
) => Promise<Response | NextResponse>;

type RouteHandlerWithoutParams<TRequest extends Request = NextRequest> = (
  request: TRequest
) => Promise<Response | NextResponse>;

type RouteHandler<TParams = Record<string, string>, TRequest extends Request = NextRequest> =
  | RouteHandlerWithoutParams<TRequest>
  | RouteHandlerWithParams<TParams, TRequest>;

export function withErrorHandling<
  TParams = Record<string, string>,
  TRequest extends Request = NextRequest
>(
  handler: RouteHandler<TParams, TRequest>,
  label: string
): (
  request: TRequest,
  context?: RouteContext<TParams>
) => Promise<Response | NextResponse> {
  return async (request, context) => {
    try {
      if (context) {
        return await (handler as RouteHandlerWithParams<TParams, TRequest>)(request, context);
      }
      return await (handler as RouteHandlerWithoutParams<TRequest>)(request);
    } catch (error) {
      console.error(`[${label}] unexpected error`, error);
      return errorResponse(ApiErrorCode.INTERNAL_ERROR, 'Internal server error', 500);
    }
  };
}
