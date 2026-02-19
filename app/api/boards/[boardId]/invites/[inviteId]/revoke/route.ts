import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase';
import { requireAuthenticatedUser, validateMutationRequestOrigin, getClientIp } from '@/lib/server/api-security';
import { checkRateLimit } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const ParamsSchema = z.object({
  boardId: z.string().uuid(),
  inviteId: z.string().uuid(),
});

type RpcInviteResult = {
  ok?: boolean;
  status?: number;
  code?: string;
  message?: string;
};

const postHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; inviteId: string }> }
) => {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return originError;
  }

  const rawParams = await params;
  const parsedParams = ParamsSchema.safeParse(rawParams);
  if (!parsedParams.success) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_BODY',
          message: 'Validation failed',
          details: parsedParams.error.flatten(),
        },
      },
      { status: 422 }
    );
  }

  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
      { status: 401 }
    );
  }

  const ip = getClientIp(request);
  const rate = await checkRateLimit({
    key: `board_invite_revoke:${user.id}:${parsedParams.data.boardId}:${ip}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      {
        status: 429,
        headers: {
          'Retry-After': Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000)).toString(),
        },
      }
    );
  }

  const { data, error } = await supabase.rpc('revoke_board_invite', {
    p_board_id: parsedParams.data.boardId,
    p_invite_id: parsedParams.data.inviteId,
  });

  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  const result = (data as RpcInviteResult | null) ?? {};
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code ?? 'DB_ERROR', message: result.message ?? 'Failed to revoke invite' } },
      { status: result.status ?? 500 }
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
};

export const POST = withErrorHandling(postHandler, 'board-invites-revoke-post');
