import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { MemberRole } from '@/lib/supabase';

// PATCH /api/boards/[boardId]/members/[profileId] - Update member role
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; profileId: string }> }
) {
  const supabase = await createServerSupabaseClient();
  const { boardId, profileId } = await params;

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { role } = body as { role: MemberRole };

    if (!role) {
      return NextResponse.json({ error: 'role is required' }, { status: 400 });
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
  const supabase = await createServerSupabaseClient();
  const { boardId, profileId } = await params;

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
