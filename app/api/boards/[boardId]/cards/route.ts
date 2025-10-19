import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

const CreateCardSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  list_id: z.string().uuid(),
  position: z.number().int().min(0),
  tags: z.array(z.string()).optional(),
  due_date: z.string().datetime().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
});

/**
 * POST /api/boards/[boardId]/cards
 *
 * Create a new card.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const { boardId } = await params;
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
    const parsed = CreateCardSchema.safeParse(body);

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

    const { data: createdCard, error } = await supabase
      .from('cards')
      .insert({ ...parsed.data, board_id: boardId })
      .select()
      .single();

    if (error) {
      console.error('Error creating card:', error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    // Log activity
    await supabase.from('activity_logs').insert({
      board_id: boardId,
      user_id: user.id,
      action: 'created',
      entity_type: 'card',
      entity_id: createdCard.id,
      entity_title: createdCard.title,
    }).catch((err) => console.error('Activity log failed:', err));

    return NextResponse.json({ card: createdCard }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/boards/[boardId]/cards:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
