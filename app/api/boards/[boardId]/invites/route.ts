import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { normalizeEmail } from '@/lib/email';
import { createServerSupabaseClient, type MemberRole } from '@/lib/supabase';
import { requireAuthenticatedUser, validateMutationRequestOrigin, getClientIp } from '@/lib/server/api-security';
import { createInviteToken, hashInviteToken } from '@/lib/server/invite-token';
import { checkRateLimit } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const CreateBoardInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['editor', 'commenter', 'viewer']).optional(),
  expires_in_hours: z.number().int().min(1).max(24 * 30).optional(),
});

async function getActorRole(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  boardId: string,
  userId: string
): Promise<MemberRole | null> {
  const { data } = await supabase
    .from('board_members')
    .select('role')
    .eq('board_id', boardId)
    .eq('profile_id', userId)
    .maybeSingle();

  return (data?.role as MemberRole | undefined) ?? null;
}

const getHandler = async (
  _request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) => {
  const { boardId } = await params;
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 });
  }

  const actorRole = await getActorRole(supabase, boardId, user.id);
  if (actorRole !== 'owner') {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('board_invites')
    .select('id, board_id, email, email_normalized, role, expires_at, accepted_at, revoked_at, created_at')
    .eq('board_id', boardId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ invites: data ?? [] }, { status: 200 });
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
    return errorResponse ?? NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 });
  }

  const actorRole = await getActorRole(supabase, boardId, user.id);
  if (actorRole !== 'owner') {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, { status: 403 });
  }

  const ip = getClientIp(request);
  const rate = await checkRateLimit({
    key: `board_invite:${user.id}:${boardId}:${ip}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, {
      status: 429,
      headers: {
        'Retry-After': Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000)).toString(),
      },
    });
  }

  const body = await request.json();
  const parsed = CreateBoardInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: {
        code: 'INVALID_BODY',
        message: 'Validation failed',
        details: parsed.error.flatten(),
      },
    }, { status: 422 });
  }

  const token = createInviteToken();
  const tokenHash = hashInviteToken(token);
  const normalizedEmail = normalizeEmail(parsed.data.email);
  const role = parsed.data.role ?? 'editor';
  const expiresInHours = parsed.data.expires_in_hours ?? 72;
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  const basePayload = {
    board_id: boardId,
    email: parsed.data.email.trim(),
    email_normalized: normalizedEmail,
    role,
    token_hash: tokenHash,
    expires_at: expiresAt,
    accepted_at: null,
    revoked_at: null,
  };

  const { data: existingPending, error: lookupError } = await supabase
    .from('board_invites')
    .select('id')
    .eq('board_id', boardId)
    .eq('email_normalized', normalizedEmail)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: { code: 'DB_ERROR', message: lookupError.message } }, { status: 500 });
  }

  const mutation = existingPending
    ? supabase
      .from('board_invites')
      .update(basePayload)
      .eq('id', existingPending.id)
      .select('id, board_id, email, email_normalized, role, expires_at, accepted_at, revoked_at, created_at')
      .single()
    : supabase
      .from('board_invites')
      .insert(basePayload)
      .select('id, board_id, email, email_normalized, role, expires_at, accepted_at, revoked_at, created_at')
      .single();

  const { data, error } = await mutation;

  if (error) {
    return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ invite: data, invite_token: token }, { status: 201 });
};

export const GET = withErrorHandling(getHandler, 'board-invites-get');
export const POST = withErrorHandling(postHandler, 'board-invites-post');
