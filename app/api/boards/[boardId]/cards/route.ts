import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

const CreateCardSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  list_id: z.string().uuid(),
  position: z.number().int().min(0),
  tags: z.array(z.string()).optional(),
  due_date: z.string().datetime().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
  checked: z.boolean().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
  short_id: z.string().nullable().optional(),
  id_short: z.number().int().min(0).nullable().optional(),
  slug: z.string().nullable().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
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

    const payload: Record<string, unknown> = {
      board_id: boardId,
      id: parsed.data.id,
      title: parsed.data.title,
      description: parsed.data.description ?? '',
      list_id: parsed.data.list_id,
      position: parsed.data.position,
      tags: parsed.data.tags ?? [],
      due_date: parsed.data.due_date ?? null,
      priority: parsed.data.priority ?? 'medium',
      checked: parsed.data.checked ?? false,
      assignee_id: parsed.data.assignee_id ?? null,
      assigned_to: parsed.data.assigned_to ?? null,
      user_id: parsed.data.user_id ?? user.id,
      short_id: parsed.data.short_id ?? null,
      id_short: parsed.data.id_short ?? null,
      slug: parsed.data.slug ?? null,
      created_at: parsed.data.created_at,
      updated_at: parsed.data.updated_at,
    };

    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    });

    const { data: createdCard, error } = await supabase
      .from('cards')
      .insert(payload)
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
    supabase.from('activity_logs').insert({
      board_id: boardId,
      user_id: user.id,
      action: 'created',
      entity_type: 'card',
      entity_id: createdCard.id,
      entity_title: createdCard.title,
    }).then(({ error: logError }) => {
      if (logError) console.error('Activity log failed:', logError);
    });

    return NextResponse.json({ card: createdCard }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/boards/[boardId]/cards:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
