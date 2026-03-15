import { NextRequest, NextResponse } from 'next/server';

import { createServerSupabaseClient, type MemberRole } from '@/lib/supabase';
import {
  getBoardMembership,
  requireAuthenticatedUser,
  validateMutationRequestOrigin,
} from '@/lib/server/api-security';
import { errorResponse, ApiErrorCode } from '@/lib/server/api-error';
import { withErrorHandling } from '@/lib/server/with-error-handling';

function lastOwnerConflictResponse(message: string) {
  return NextResponse.json(
    {
      error: {
        code: 'LAST_BOARD_OWNER_TRANSFER_REQUIRED',
        message,
      },
    },
    { status: 409 }
  );
}

function asConflictIfLastOwner(message?: string | null) {
  if (!message) return null;
  if (message.includes('last board owner')) {
    return lastOwnerConflictResponse('Transfer board ownership before removing or demoting the last owner.');
  }
  return null;
}

const patchHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; profileId: string }> }
) => {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return originError;
  }

  const supabase = await createServerSupabaseClient();
  const { boardId, profileId } = await params;
  const { user, errorResponse: authError } = await requireAuthenticatedUser(supabase);
  if (authError || !user) {
    return authError ?? errorResponse(ApiErrorCode.UNAUTHENTICATED, 'Login required', 401);
  }

  const actorMembership = await getBoardMembership(supabase, boardId, user.id);
  if (!actorMembership || actorMembership.role !== 'owner') {
    return errorResponse(ApiErrorCode.FORBIDDEN, 'Only owner can update member roles', 403);
  }

  const body = await request.json();
  const { role } = body as { role?: MemberRole };
  if (!role) {
    return errorResponse(ApiErrorCode.INVALID_BODY, 'role is required', 400);
  }

  const { data: targetMembership, error: targetError } = await supabase
    .from('board_members')
    .select('role')
    .eq('board_id', boardId)
    .eq('profile_id', profileId)
    .maybeSingle();

  if (targetError) {
    return errorResponse(ApiErrorCode.DB_ERROR, targetError.message, 500);
  }
  if (!targetMembership) {
    return errorResponse(ApiErrorCode.NOT_FOUND, 'Member not found', 404);
  }

  if (targetMembership.role === 'owner' && role !== 'owner') {
    const { count, error: ownerCountError } = await supabase
      .from('board_members')
      .select('profile_id', { count: 'exact', head: true })
      .eq('board_id', boardId)
      .eq('role', 'owner');

    if (ownerCountError) {
      return errorResponse(ApiErrorCode.DB_ERROR, ownerCountError.message, 500);
    }

    if ((count ?? 0) <= 1) {
      return lastOwnerConflictResponse('Transfer board ownership before demoting the last owner.');
    }
  }

  const { data: updatedMember, error } = await supabase
    .from('board_members')
    .update({ role })
    .eq('board_id', boardId)
    .eq('profile_id', profileId)
    .select()
    .single();

  if (error) {
    const conflict = asConflictIfLastOwner(error.message);
    if (conflict) return conflict;
    console.error('Error updating member role:', error);
    return errorResponse(ApiErrorCode.DB_ERROR, error.message, 500);
  }

  return NextResponse.json({ member: updatedMember }, { status: 200 });
};

const deleteHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; profileId: string }> }
) => {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return originError;
  }

  const supabase = await createServerSupabaseClient();
  const { boardId, profileId } = await params;
  const { user, errorResponse: authError } = await requireAuthenticatedUser(supabase);
  if (authError || !user) {
    return authError ?? errorResponse(ApiErrorCode.UNAUTHENTICATED, 'Login required', 401);
  }

  const actorMembership = await getBoardMembership(supabase, boardId, user.id);
  if (!actorMembership || actorMembership.role !== 'owner') {
    return errorResponse(ApiErrorCode.FORBIDDEN, 'Only owner can remove members', 403);
  }

  const { data: targetMembership, error: targetError } = await supabase
    .from('board_members')
    .select('role')
    .eq('board_id', boardId)
    .eq('profile_id', profileId)
    .maybeSingle();

  if (targetError) {
    return errorResponse(ApiErrorCode.DB_ERROR, targetError.message, 500);
  }
  if (!targetMembership) {
    return errorResponse(ApiErrorCode.NOT_FOUND, 'Member not found', 404);
  }

  if (targetMembership.role === 'owner') {
    const { count, error: ownerCountError } = await supabase
      .from('board_members')
      .select('profile_id', { count: 'exact', head: true })
      .eq('board_id', boardId)
      .eq('role', 'owner');

    if (ownerCountError) {
      return errorResponse(ApiErrorCode.DB_ERROR, ownerCountError.message, 500);
    }

    if ((count ?? 0) <= 1) {
      return lastOwnerConflictResponse('Transfer board ownership before removing the last owner.');
    }
  }

  const { error } = await supabase
    .from('board_members')
    .delete()
    .eq('board_id', boardId)
    .eq('profile_id', profileId);

  if (error) {
    const conflict = asConflictIfLastOwner(error.message);
    if (conflict) return conflict;
    console.error('Error removing member:', error);
    return errorResponse(ApiErrorCode.DB_ERROR, error.message, 500);
  }

  return NextResponse.json({ success: true }, { status: 200 });
};

export const PATCH = withErrorHandling(patchHandler, 'board-members-by-profile-patch');
export const DELETE = withErrorHandling(deleteHandler, 'board-members-by-profile-delete');
