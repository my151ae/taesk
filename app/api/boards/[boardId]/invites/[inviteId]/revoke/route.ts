import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase';
import {
  getBoardMembership,
  getClientIp,
  requireAuthenticatedUser,
  validateMutationRequestOrigin,
} from '@/lib/server/api-security';
import { hasAnyTeamRole } from '@/lib/server/team-security';
import { checkRateLimit } from '@/lib/server/rate-limit';
import { errorResponse, ApiErrorCode } from '@/lib/server/api-error';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const ParamsSchema = z.object({
  boardId: z.string().uuid(),
  inviteId: z.string().uuid(),
});

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
    return errorResponse(ApiErrorCode.INVALID_BODY, 'Validation failed', 422, parsedParams.error.flatten());
  }

  const supabase = await createServerSupabaseClient();
  const { user, errorResponse: authError } = await requireAuthenticatedUser(supabase);
  if (authError || !user) {
    return authError ?? errorResponse(ApiErrorCode.UNAUTHENTICATED, 'Login required', 401);
  }

  const actorMembership = await getBoardMembership(supabase, parsedParams.data.boardId, user.id);
  if (!actorMembership || actorMembership.role !== 'owner') {
    return errorResponse(ApiErrorCode.FORBIDDEN, 'Only board owners can manage board access', 403);
  }

  const { data: board, error: boardError } = await supabase
    .from('boards')
    .select('team_id')
    .eq('id', parsedParams.data.boardId)
    .maybeSingle();

  if (boardError) {
    return errorResponse(ApiErrorCode.DB_ERROR, boardError.message, 500);
  }
  if (!board?.team_id) {
    return errorResponse(ApiErrorCode.CONFLICT, 'Board must belong to a team before invites can be managed', 409);
  }

  const { data: teamMembership, error: teamMembershipError } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', board.team_id)
    .eq('profile_id', user.id)
    .maybeSingle();

  if (teamMembershipError) {
    return errorResponse(ApiErrorCode.DB_ERROR, teamMembershipError.message, 500);
  }
  if (!hasAnyTeamRole(teamMembership?.role, ['owner', 'admin'])) {
    return errorResponse(
      ApiErrorCode.FORBIDDEN,
      'Only team owners or admins can revoke pending board access invites',
      403
    );
  }

  const ip = getClientIp(request);
  const rate = await checkRateLimit({
    key: `board_access_invite_revoke:${user.id}:${parsedParams.data.boardId}:${ip}`,
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

  const { data: pendingInvite, error: pendingInviteError } = await supabase
    .from('pending_board_access_invites')
    .select('id, team_invite_id, accepted_at, revoked_at')
    .eq('id', parsedParams.data.inviteId)
    .eq('board_id', parsedParams.data.boardId)
    .maybeSingle();

  if (pendingInviteError) {
    return errorResponse(ApiErrorCode.DB_ERROR, pendingInviteError.message, 500);
  }
  if (!pendingInvite) {
    return errorResponse(ApiErrorCode.NOT_FOUND, 'Invite not found', 404);
  }
  if (pendingInvite.accepted_at) {
    return errorResponse(ApiErrorCode.CONFLICT, 'Invite already accepted', 409);
  }

  if (pendingInvite.team_invite_id) {
    const { error: revokeTeamInviteError } = await supabase.rpc('revoke_team_invite', {
      p_team_id: board.team_id,
      p_invite_id: pendingInvite.team_invite_id,
    });

    if (revokeTeamInviteError) {
      return errorResponse(ApiErrorCode.DB_ERROR, revokeTeamInviteError.message, 500);
    }
  } else {
    const { error: revokePendingError } = await supabase
      .from('pending_board_access_invites')
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
      })
      .eq('id', pendingInvite.id);

    if (revokePendingError) {
      return errorResponse(ApiErrorCode.DB_ERROR, revokePendingError.message, 500);
    }
  }

  return NextResponse.json({ success: true }, { status: 200 });
};

export const POST = withErrorHandling(postHandler, 'board-invites-revoke-post');
