import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase';
import { requireAuthenticatedUser, validateMutationRequestOrigin } from '@/lib/server/api-security';
import { hasAnyTeamRole } from '@/lib/server/team-security';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const UpdateRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'guest']),
});

function asConflictIfLastOwner(message?: string | null) {
  if (!message) return null;
  if (message.includes('last team owner')) {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'Cannot change the last team owner' } },
      { status: 409 }
    );
  }
  if (message.includes('LAST_BOARD_OWNER_TRANSFER_REQUIRED')) {
    return NextResponse.json(
      {
        error: {
          code: 'LAST_BOARD_OWNER_TRANSFER_REQUIRED',
          message: 'Transfer board ownership before removing this team member.',
        },
      },
      { status: 409 }
    );
  }
  return null;
}

async function findBlockingBoardOwner(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  teamId: string,
  profileId: string
) {
  const { data, error } = await supabase
    .from('boards')
    .select(`
      id,
      name,
      board_members!inner (
        profile_id,
        role
      )
    `)
    .eq('team_id', teamId)
    .eq('board_members.profile_id', profileId)
    .eq('board_members.role', 'owner');

  if (error) {
    return { error, board: null };
  }

  const boards = (data ?? []) as Array<{
    id: string;
    name: string | null;
  }>;

  for (const board of boards) {
    const { count, error: ownerCountError } = await supabase
      .from('board_members')
      .select('profile_id', { count: 'exact', head: true })
      .eq('board_id', board.id)
      .eq('role', 'owner');

    if (ownerCountError) {
      return { error: ownerCountError, board: null };
    }

    if ((count ?? 0) <= 1) {
      return { error: null, board };
    }
  }

  return { error: null, board: null };
}

const patchHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; profileId: string }> }
) => {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return originError;
  }

  const { teamId, profileId } = await params;
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
      { status: 401 }
    );
  }

  const { data: actor } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!actor || !hasAnyTeamRole(actor.role, ['owner', 'admin'])) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = UpdateRoleSchema.safeParse(body);
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

  if (parsed.data.role === 'owner' && actor.role !== 'owner') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Only owner can assign owner role' } },
      { status: 403 }
    );
  }

  const { data: target } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', profileId)
    .maybeSingle();

  if (!target) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Member not found' } },
      { status: 404 }
    );
  }

  if (target.role === 'owner' && actor.role !== 'owner') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Only owner can modify owner role' } },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from('team_members')
    .update({ role: parsed.data.role })
    .eq('team_id', teamId)
    .eq('profile_id', profileId)
    .select('team_id, profile_id, role, created_at')
    .single();

  if (error) {
    const conflict = asConflictIfLastOwner(error.message);
    if (conflict) return conflict;

    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({ member: data }, { status: 200 });
};

const deleteHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; profileId: string }> }
) => {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return originError;
  }

  const { teamId, profileId } = await params;
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
      { status: 401 }
    );
  }

  const { data: actor } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!actor) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
      { status: 403 }
    );
  }

  const isSelf = profileId === user.id;
  if (!isSelf && !hasAnyTeamRole(actor.role, ['owner', 'admin'])) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
      { status: 403 }
    );
  }

  const { data: target } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', profileId)
    .maybeSingle();

  if (!target) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Member not found' } },
      { status: 404 }
    );
  }

  if (target.role === 'owner' && actor.role !== 'owner') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Only owner can remove owner' } },
      { status: 403 }
    );
  }

  const { error: blockingLookupError, board: blockingBoard } = await findBlockingBoardOwner(
    supabase,
    teamId,
    profileId
  );

  if (blockingLookupError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: blockingLookupError.message } },
      { status: 500 }
    );
  }

  if (blockingBoard) {
    return NextResponse.json(
      {
        error: {
          code: 'LAST_BOARD_OWNER_TRANSFER_REQUIRED',
          message: `Transfer board ownership before removing this team member from ${blockingBoard.name ?? 'the board'}.`,
        },
      },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('profile_id', profileId);

  if (error) {
    const conflict = asConflictIfLastOwner(error.message);
    if (conflict) return conflict;

    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
};

export const PATCH = withErrorHandling(patchHandler, 'team-member-by-profile-patch');
export const DELETE = withErrorHandling(deleteHandler, 'team-member-by-profile-delete');
