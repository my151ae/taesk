import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

const CardUpdateSchema = z.object({
  id: z.string().uuid(),
  list_id: z.string().uuid(),
  position: z.number().int().min(0),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  due_date: z.union([z.string().datetime(), z.null()]).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  assignee_id: z.union([z.string().uuid(), z.null()]).optional(),
  assigned_to: z.union([z.string(), z.null()]).optional(),
  user_id: z.union([z.string().uuid(), z.null()]).optional(),
  short_id: z.union([z.string(), z.null()]).optional(),
  id_short: z.union([z.number().int().min(0), z.null()]).optional(),
  slug: z.union([z.string(), z.null()]).optional(),
  updated_at: z.string().datetime().optional(),
  created_at: z.string().datetime().optional(),
});

const ReorderCardsSchema = z.object({
  updates: z.array(CardUpdateSchema).min(1),
});

/**
 * PATCH /api/boards/[boardId]/cards/reorder
 *
 * Bulk update card positions and list assignments (for drag & drop and sync).
 */
export async function PATCH(
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
    const parsed = ReorderCardsSchema.safeParse(body);

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

    // Add board_id and retain card attributes needed for inserts
    const updates = parsed.data.updates.map((u) => {
      const assigneeId = typeof u.assignee_id === 'string' && u.assignee_id.length > 0
        ? u.assignee_id
        : null;

      return {
        id: u.id,
        board_id: boardId,
        list_id: u.list_id,
        position: u.position,
        title: u.title,
        description: u.description ?? '',
        tags: u.tags ?? [],
        due_date: u.due_date ?? null,
        priority: u.priority ?? 'medium',
        assignee_id: assigneeId,
        assigned_to: (u.assigned_to ?? null) || null,
        user_id: u.user_id ?? null,
        short_id: u.short_id ?? null,
        id_short: u.id_short ?? null,
        slug: u.slug ?? null,
        ...(u.updated_at ? { updated_at: u.updated_at } : {}),
        ...(u.created_at ? { created_at: u.created_at } : {}),
      };
    });

    const { error } = await supabase.from('cards').upsert(updates);

    if (error) {
      console.error('Error reordering cards:', error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    // Log activity
    supabase.from('activity_logs').insert({
      board_id: boardId,
      user_id: user.id,
      action: 'updated',
      entity_type: 'card',
      entity_id: boardId,
      entity_title: 'Cards reordered',
      details: { count: updates.length },
    }).then(({ error: logError }) => {
      if (logError) console.error('Activity log failed:', logError);
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/boards/[boardId]/cards/reorder:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
