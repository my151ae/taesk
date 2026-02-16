import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { MemberRole } from '@/lib/supabase';
import {
  getBoardMembership,
  requireAuthenticatedUser,
  validateMutationRequestOrigin,
} from '@/lib/server/api-security';

// PATCH /api/boards/[boardId]/members/[profileId] - Update member role
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; profileId: string }> }
) {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return originError;
  }

  const supabase = await createServerSupabaseClient();
  const { boardId, profileId } = await params;

  try {
    const { user, errorResponse } = await requireAuthenticatedUser(supabase);
    if (errorResponse || !user) {
      return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actorMembership = await getBoardMembership(supabase, boardId, user.id);

    if (!actorMembership || actorMembership.role !== 'owner') {
      return NextResponse.json({ error: 'Only owner can update member roles' }, { status: 403 });
    }

    const body = await request.json();
    const { role } = body as { role: MemberRole };

    if (!role) {
      return NextResponse.json({ error: 'role is required' }, { status: 400 });
    }

    const { data: targetMembership } = await supabase
      .from('board_members')
      .select('role')
      .eq('board_id', boardId)
      .eq('profile_id', profileId)
      .maybeSingle();

    if (!targetMembership) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    if (targetMembership.role === 'owner' && role !== 'owner') {
      const { count } = await supabase
        .from('board_members')
        .select('profile_id', { count: 'exact', head: true })
        .eq('board_id', boardId)
        .eq('role', 'owner');

      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: 'Cannot demote the last owner' }, { status: 409 });
      }
    }

    // Update member role
    const { data: updatedMember, error } = await supabase
      .from('board_members')
      .update({ role })
      .eq('board_id', boardId)
      .eq('profile_id', profileId)
      .select()
      .single();

    if (error) {
      console.error('Error updating member role:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ member: updatedMember });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/boards/[boardId]/members/[profileId]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/boards/[boardId]/members/[profileId] - Remove member
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; profileId: string }> }
) {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return originError;
  }

  const supabase = await createServerSupabaseClient();
  const { boardId, profileId } = await params;

  try {
    const { user, errorResponse } = await requireAuthenticatedUser(supabase);
    if (errorResponse || !user) {
      return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actorMembership = await getBoardMembership(supabase, boardId, user.id);

    const { data: targetMembership } = await supabase
      .from('board_members')
      .select('role')
      .eq('board_id', boardId)
      .eq('profile_id', profileId)
      .maybeSingle();

    if (!targetMembership) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const isSelfRemoval = user.id === profileId;
    if (!isSelfRemoval && (!actorMembership || actorMembership.role !== 'owner')) {
      return NextResponse.json({ error: 'Only owner can remove other members' }, { status: 403 });
    }

    if (targetMembership.role === 'owner') {
      const { count } = await supabase
        .from('board_members')
        .select('profile_id', { count: 'exact', head: true })
        .eq('board_id', boardId)
        .eq('role', 'owner');

      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: 'Cannot remove the last owner' }, { status: 409 });
      }
    }

    // Delete member
    const { error } = await supabase
      .from('board_members')
      .delete()
      .eq('board_id', boardId)
      .eq('profile_id', profileId);

    if (error) {
      console.error('Error removing member:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in DELETE /api/boards/[boardId]/members/[profileId]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
