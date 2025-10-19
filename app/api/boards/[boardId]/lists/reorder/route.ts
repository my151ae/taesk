import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

const ReorderListsSchema = z.object({
  updates: z.array(z.object({
    id: z.string().uuid(),
    position: z.number().int().min(0),
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

    const updates = parsed.data.updates;

    const idSet = new Set<string>();
    const positionSet = new Set<number>();

    for (const update of updates) {
      if (idSet.has(update.id)) {
        return NextResponse.json(
          { error: { code: 'INVALID_BODY', message: 'Duplicate list ID detected in updates payload.' } },
          { status: 400 }
        );
      }
      idSet.add(update.id);

      if (positionSet.has(update.position)) {
        return NextResponse.json(
          { error: { code: 'INVALID_BODY', message: 'Duplicate list position detected.' } },
          { status: 400 }
        );
      }
      positionSet.add(update.position);
    }

    const listIds = updates.map((u) => u.id);

    const { data: existingLists, error: fetchListsError } = await supabase
      .from('lists')
      .select('id, board_id, position')
      .in('id', listIds);

    if (fetchListsError) {
      console.error('[lists/reorder] Failed to fetch current list state', fetchListsError);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: fetchListsError.message } },
        { status: 500 }
      );
    }

    if (!existingLists || existingLists.length !== updates.length) {
      const foundIds = new Set(existingLists?.map((list) => list.id) ?? []);
      const missing = updates.filter((u) => !foundIds.has(u.id)).map((u) => u.id);
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'One or more lists do not exist or do not belong to this board.',
            details: { missing },
          },
        },
        { status: 400 }
      );
    }

    const invalidList = existingLists.find((list) => list.board_id !== boardId);
    if (invalidList) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Updates contain lists from a different board.',
            details: { listId: invalidList.id, boardId: invalidList.board_id },
          },
        },
        { status: 400 }
      );
    }

    const originalState = new Map(existingLists.map((list) => [list.id, list.position]));

    for (const { id, position } of updates) {
      const { error: updateError } = await supabase
        .from('lists')
        .update({ position })
        .eq('id', id)
        .eq('board_id', boardId);

      if (updateError) {
        console.error('[lists/reorder] Update failed', {
          payload: { id, position },
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint,
          code: updateError.code,
        });

        await Promise.all(
          Array.from(originalState.entries()).map(([listId, originalPosition]) =>
            supabase
              .from('lists')
              .update({ position: originalPosition })
              .eq('id', listId)
              .eq('board_id', boardId)
          )
        );

        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: updateError.message } },
          { status: 500 }
        );
      }
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
