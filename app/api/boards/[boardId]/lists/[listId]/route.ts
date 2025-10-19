import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

const UpdateListSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  position: z.number().int().min(0).optional(),
}).refine(data => data.title !== undefined || data.position !== undefined, {
  message: 'At least one field (title or position) must be provided',
});

/**
 * PATCH /api/boards/[boardId]/lists/[listId]
 *
 * Update a single list (title and/or position).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; listId: string }> }
) {
  try {
    const { boardId, listId } = await params;
    const supabase = await createServerSupabaseClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401 }
      );
    }

    const { data: membership } = await supabase
      .from('board_members')
      .select('role')
      .eq('board_id', boardId)
      .eq('profile_id', user.id)
      .maybeSingle();

    if (!membership || (membership.role !== 'owner' && membership.role !== 'editor')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = UpdateListSchema.safeParse(body);

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

    const { data: updatedList, error } = await supabase
      .from('lists')
      .update(parsed.data)
      .eq('id', listId)
      .eq('board_id', boardId)
      .select()
      .single();

    if (error) {
      console.error('Error updating list:', error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    if (!updatedList) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'List not found' } },
        { status: 404 }
      );
    }

    // Log activity
    await supabase.from('activity_logs').insert({
      board_id: boardId,
      user_id: user.id,
      action: 'updated',
      entity_type: 'list',
      entity_id: listId,
      entity_title: updatedList.title,
    }).catch((err) => console.error('Activity log failed:', err));

    return NextResponse.json({ list: updatedList }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/boards/[boardId]/lists/[listId]:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/boards/[boardId]/lists/[listId]
 *
 * Delete a list (CASCADE will delete associated cards).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; listId: string }> }
) {
  try {
    const { boardId, listId } = await params;
    const supabase = await createServerSupabaseClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401 }
      );
    }

    const { data: membership } = await supabase
      .from('board_members')
      .select('role')
      .eq('board_id', boardId)
      .eq('profile_id', user.id)
      .maybeSingle();

    if (!membership || (membership.role !== 'owner' && membership.role !== 'editor')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        { status: 403 }
      );
    }

    // Get list info before deletion for activity log
    const { data: list } = await supabase
      .from('lists')
      .select('title')
      .eq('id', listId)
      .eq('board_id', boardId)
      .single();

    const { error } = await supabase
      .from('lists')
      .delete()
      .eq('id', listId)
      .eq('board_id', boardId);

    if (error) {
      console.error('Error deleting list:', error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    // Log activity
    if (list) {
      await supabase.from('activity_logs').insert({
        board_id: boardId,
        user_id: user.id,
        action: 'deleted',
        entity_type: 'list',
        entity_id: listId,
        entity_title: list.title,
      }).catch((err) => console.error('Activity log failed:', err));
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Unexpected error in DELETE /api/boards/[boardId]/lists/[listId]:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
