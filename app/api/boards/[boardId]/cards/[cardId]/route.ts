import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

const UpdateCardSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  list_id: z.string().uuid().optional(),
  position: z.number().int().min(0).optional(),
  tags: z.array(z.string()).optional(),
  due_date: z.string().datetime().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
});

/**
 * PATCH /api/boards/[boardId]/cards/[cardId]
 *
 * Update a single card (partial update).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> }
) {
  try {
    const { boardId, cardId } = await params;
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
    const parsed = UpdateCardSchema.safeParse(body);

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

    const { data: updatedCard, error } = await supabase
      .from('cards')
      .update(parsed.data)
      .eq('id', cardId)
      .eq('board_id', boardId)
      .select()
      .single();

    if (error) {
      console.error('Error updating card:', error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    if (!updatedCard) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Card not found' } },
        { status: 404 }
      );
    }

    // Log activity
    const action = parsed.data.list_id ? 'moved' : 'updated';
    await supabase.from('activity_logs').insert({
      board_id: boardId,
      user_id: user.id,
      action,
      entity_type: 'card',
      entity_id: cardId,
      entity_title: updatedCard.title,
    }).catch((err) => console.error('Activity log failed:', err));

    return NextResponse.json({ card: updatedCard }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/boards/[boardId]/cards/[cardId]:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/boards/[boardId]/cards/[cardId]
 *
 * Delete a card.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> }
) {
  try {
    const { boardId, cardId } = await params;
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

    // Get card info before deletion
    const { data: card } = await supabase
      .from('cards')
      .select('title')
      .eq('id', cardId)
      .eq('board_id', boardId)
      .single();

    const { error } = await supabase
      .from('cards')
      .delete()
      .eq('id', cardId)
      .eq('board_id', boardId);

    if (error) {
      console.error('Error deleting card:', error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    // Log activity
    if (card) {
      await supabase.from('activity_logs').insert({
        board_id: boardId,
        user_id: user.id,
        action: 'deleted',
        entity_type: 'card',
        entity_id: cardId,
        entity_title: card.title,
      }).catch((err) => console.error('Activity log failed:', err));
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Unexpected error in DELETE /api/boards/[boardId]/cards/[cardId]:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
