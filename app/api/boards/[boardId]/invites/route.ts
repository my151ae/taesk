import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { normalizeEmail } from '@/lib/email';
import { createServerSupabaseClient, type MemberRole } from '@/lib/supabase';
import {
  requireAuthenticatedUser,
  validateMutationRequestOrigin,
  getClientIp,
  getBoardMembership,
} from '@/lib/server/api-security';
import { createInviteToken, hashInviteToken } from '@/lib/server/invite-token';
import { checkRateLimit } from '@/lib/server/rate-limit';
import { hasAnyTeamRole } from '@/lib/server/team-security';
import { errorResponse, ApiErrorCode } from '@/lib/server/api-error';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const CreateBoardInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['editor', 'commenter', 'viewer']).optional(),
  expires_in_hours: z.number().int().min(1).max(24 * 30).optional(),
});

type PendingInviteRow = {
  id: string;
  board_id: string;
  email: string;
  normalized_email: string;
  board_role: Exclude<MemberRole, 'owner'>;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  team_invites:
    | {
        expires_at: string | null;
      }
    | Array<{ expires_at: string | null }>
    | null;
};

async function requireBoardOwner(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  boardId: string,
  userId: string
) {
  const membership = await getBoardMembership(supabase, boardId, userId);
  if (!membership || membership.role !== 'owner') {
    return errorResponse(ApiErrorCode.FORBIDDEN, 'Only board owners can manage board access', 403);
  }
  return null;
}

async function getBoardContext(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  boardId: string,
  userId: string
) {
  const { data: board, error: boardError } = await supabase
    .from('boards')
    .select('id, team_id')
    .eq('id', boardId)
    .maybeSingle();

  if (boardError) {
    return { error: errorResponse(ApiErrorCode.DB_ERROR, boardError.message, 500), board: null, teamRole: null };
  }
  if (!board?.team_id) {
    return {
      error: errorResponse(ApiErrorCode.CONFLICT, 'Board must belong to a team before invites can be managed', 409),
      board: null,
      teamRole: null,
    };
  }

  const { data: teamMembership, error: teamError } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', board.team_id)
    .eq('profile_id', userId)
    .maybeSingle();

  if (teamError) {
    return { error: errorResponse(ApiErrorCode.DB_ERROR, teamError.message, 500), board: null, teamRole: null };
  }

  return { error: null, board, teamRole: teamMembership?.role ?? null };
}

const getHandler = async (
  _request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) => {
  const { boardId } = await params;
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse: authError } = await requireAuthenticatedUser(supabase);
  if (authError || !user) {
    return authError ?? errorResponse(ApiErrorCode.UNAUTHENTICATED, 'Login required', 401);
  }

  const boardOwnerError = await requireBoardOwner(supabase, boardId, user.id);
  if (boardOwnerError) {
    return boardOwnerError;
  }

  const { error: contextError, board, teamRole } = await getBoardContext(supabase, boardId, user.id);
  if (contextError || !board) {
    return contextError ?? errorResponse(ApiErrorCode.NOT_FOUND, 'Board not found', 404);
  }

  if (!hasAnyTeamRole(teamRole, ['owner', 'admin'])) {
    return errorResponse(
      ApiErrorCode.FORBIDDEN,
      'Only team owners or admins can invite new team members from board settings',
      403
    );
  }

  const { data, error } = await supabase
    .from('pending_board_access_invites')
    .select(`
      id,
      board_id,
      email,
      normalized_email,
      board_role,
      accepted_at,
      revoked_at,
      created_at,
      team_invites:team_invite_id (
        expires_at
      )
    `)
    .eq('board_id', board.id)
    .order('created_at', { ascending: false });

  if (error) {
    return errorResponse(ApiErrorCode.DB_ERROR, error.message, 500);
  }

  const invites = ((data as PendingInviteRow[] | null) ?? []).map((invite) => {
    const teamInvite = Array.isArray(invite.team_invites) ? invite.team_invites[0] : invite.team_invites;
    return {
      id: invite.id,
      board_id: invite.board_id,
      email: invite.email,
      email_normalized: invite.normalized_email,
      role: invite.board_role,
      expires_at: teamInvite?.expires_at ?? null,
      accepted_at: invite.accepted_at,
      revoked_at: invite.revoked_at,
      created_at: invite.created_at,
    };
  });

  return NextResponse.json({ invites }, { status: 200 });
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
  const { user, errorResponse: authError } = await requireAuthenticatedUser(supabase);
  if (authError || !user) {
    return authError ?? errorResponse(ApiErrorCode.UNAUTHENTICATED, 'Login required', 401);
  }

  const boardOwnerError = await requireBoardOwner(supabase, boardId, user.id);
  if (boardOwnerError) {
    return boardOwnerError;
  }

  const { error: contextError, board, teamRole } = await getBoardContext(supabase, boardId, user.id);
  if (contextError || !board) {
    return contextError ?? errorResponse(ApiErrorCode.NOT_FOUND, 'Board not found', 404);
  }

  if (!hasAnyTeamRole(teamRole, ['owner', 'admin'])) {
    return errorResponse(
      ApiErrorCode.FORBIDDEN,
      'Only team owners or admins can invite new team members from board settings',
      403
    );
  }

  const ip = getClientIp(request);
  const rate = await checkRateLimit({
    key: `board_access_invite:${user.id}:${boardId}:${ip}`,
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
  const parsed = CreateBoardInviteSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(ApiErrorCode.INVALID_BODY, 'Validation failed', 422, parsed.error.flatten());
  }

  const normalizedEmail = normalizeEmail(parsed.data.email);
  const role = parsed.data.role ?? 'editor';
  const expiresInHours = parsed.data.expires_in_hours ?? 72;
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
  const token = createInviteToken();
  const tokenHash = hashInviteToken(token);

  const { data: existingPending, error: pendingLookupError } = await supabase
    .from('pending_board_access_invites')
    .select('id, team_invite_id')
    .eq('team_id', board.team_id)
    .eq('board_id', board.id)
    .eq('normalized_email', normalizedEmail)
    .eq('status', 'pending')
    .is('accepted_at', null)
    .is('revoked_at', null)
    .maybeSingle();

  if (pendingLookupError) {
    return errorResponse(ApiErrorCode.DB_ERROR, pendingLookupError.message, 500);
  }

  const { data: existingTeamInvite, error: teamInviteLookupError } = await supabase
    .from('team_invites')
    .select('id')
    .eq('team_id', board.team_id)
    .eq('email_normalized', normalizedEmail)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .maybeSingle();

  if (teamInviteLookupError) {
    return errorResponse(ApiErrorCode.DB_ERROR, teamInviteLookupError.message, 500);
  }

  const teamInvitePayload = {
    team_id: board.team_id,
    email: parsed.data.email.trim(),
    email_normalized: normalizedEmail,
    role: 'guest' as const,
    token_hash: tokenHash,
    invited_by: user.id,
    expires_at: expiresAt,
    accepted_at: null,
    revoked_at: null,
  };

  const teamInviteMutation = existingTeamInvite
    ? supabase
        .from('team_invites')
        .update(teamInvitePayload)
        .eq('id', existingTeamInvite.id)
        .select('id, expires_at')
        .single()
    : supabase
        .from('team_invites')
        .insert(teamInvitePayload)
        .select('id, expires_at')
        .single();

  const { data: teamInvite, error: teamInviteError } = await teamInviteMutation;
  if (teamInviteError || !teamInvite?.id) {
    return errorResponse(ApiErrorCode.DB_ERROR, teamInviteError?.message ?? 'Failed to create team invite', 500);
  }

  const pendingPayload = {
    team_id: board.team_id,
    board_id: board.id,
    team_invite_id: teamInvite.id,
    email: parsed.data.email.trim(),
    normalized_email: normalizedEmail,
    board_role: role,
    invited_by: user.id,
    status: 'pending',
    accepted_at: null,
    revoked_at: null,
  };

  const pendingMutation = existingPending
    ? supabase
        .from('pending_board_access_invites')
        .update(pendingPayload)
        .eq('id', existingPending.id)
        .select('id, board_id, email, normalized_email, board_role, accepted_at, revoked_at, created_at')
        .single()
    : supabase
        .from('pending_board_access_invites')
        .insert(pendingPayload)
        .select('id, board_id, email, normalized_email, board_role, accepted_at, revoked_at, created_at')
        .single();

  const { data: pendingInvite, error: pendingError } = await pendingMutation;
  if (pendingError || !pendingInvite) {
    return errorResponse(
      ApiErrorCode.DB_ERROR,
      pendingError?.message ?? 'Failed to create pending board access invite',
      500
    );
  }

  return NextResponse.json(
    {
      invite: {
        id: pendingInvite.id,
        board_id: pendingInvite.board_id,
        email: pendingInvite.email,
        email_normalized: pendingInvite.normalized_email,
        role: pendingInvite.board_role,
        expires_at: teamInvite.expires_at,
        accepted_at: pendingInvite.accepted_at,
        revoked_at: pendingInvite.revoked_at,
        created_at: pendingInvite.created_at,
      },
      invite_token: token,
      delivery: 'team_invite_with_pending_board_access',
    },
    { status: 201 }
  );
};

export const GET = withErrorHandling(getHandler, 'board-invites-get');
export const POST = withErrorHandling(postHandler, 'board-invites-post');
