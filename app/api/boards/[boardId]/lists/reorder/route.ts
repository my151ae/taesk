import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

const ReorderListsSchema = z.object({
  updates: z.array(z.object({
    id: z.string().uuid(),
    position: z.number().int().min(0),
    title: z.string().min(1).max(255),
    updated_at: z.string().datetime().optional(),
  })).min(1),
});

/**
 * PATCH /api/boards/[boardId]/lists/reorder
 *
 * Bulk update list positions (for drag & drop and sync).
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
    const parsed = ReorderListsSchema.safeParse(body);

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

    // Add board_id to each update
    const updates = parsed.data.updates.map(u => ({
      id: u.id,
      board_id: boardId,
      position: u.position,
    }));

    const { error } = await supabase.from('lists').upsert(updates);

    if (error) {
      console.error('Error reordering lists:', error);
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
      entity_type: 'list',
      entity_id: boardId,
      entity_title: 'Lists reordered',
      details: { count: updates.length },
    }).then(({ error: logError }) => {
      if (logError) console.error('Activity log failed:', logError);
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/boards/[boardId]/lists/reorder:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
