import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase';
import { requireAuthenticatedUser, validateMutationRequestOrigin, getClientIp } from '@/lib/server/api-security';
import { checkRateLimit } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const AcceptInviteSchema = z.object({
  token: z.string().min(16),
});

type RpcInviteResult = {
  ok?: boolean;
  status?: number;
  code?: string;
  message?: string;
  board_id?: string;
  role?: string;
};

const postHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) => {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return originError;
  }

  const { boardId } = await params;
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
    key: `board_invite_accept:${user.id}:${boardId}:${ip}`,
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

  const body = await request.json();
  const parsed = AcceptInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_BODY',
          message: 'Validation failed',
          details: parsed.error.flatten(),
        },
      },
      { status: 422 }
    );
  }

  const { data, error } = await supabase.rpc('accept_board_invite', { p_token: parsed.data.token });
  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  const result = (data as RpcInviteResult | null) ?? {};
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code ?? 'DB_ERROR', message: result.message ?? 'Failed to accept invite' } },
      { status: result.status ?? 500 }
    );
  }

  if (result.board_id && result.board_id !== boardId) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Invite target mismatch' } },
      { status: 403 }
    );
  }

  return NextResponse.json({ success: true, board_id: result.board_id, role: result.role }, { status: 200 });
};

export const POST = withErrorHandling(postHandler, 'board-invites-accept-post');
