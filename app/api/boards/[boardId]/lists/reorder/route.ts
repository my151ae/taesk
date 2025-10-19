import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

const ListReorderUpdateSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int(),
});

const ReorderListsSchema = z.object({
  updates: z.array(ListReorderUpdateSchema).min(1),
});

interface ValidationIssue {
  code: string;
  id?: string;
  expected_board_id?: string;
  actual_board_id?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  const { boardId } = await params;
  const supabase = await createServerSupabaseClient();

  try {
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
        { error: { code: 'INVALID_BODY', message: 'Validation failed', details: parsed.error.flatten() } },
        { status: 400 }
      );
    }

    const updates = parsed.data.updates;
    const issues: ValidationIssue[] = [];

    const seenIds = new Set<string>();
    const seenPositions = new Set<number>();

    for (const update of updates) {
      if (seenIds.has(update.id)) {
        issues.push({ code: 'DUPLICATE_ID', id: update.id });
      }
      seenIds.add(update.id);

      if (seenPositions.has(update.position)) {
        issues.push({ code: 'DUPLICATE_POSITION', id: update.id });
      }
      seenPositions.add(update.position);
    }

    if (issues.length > 0) {
      return NextResponse.json({ error: 'Bad Request', issues }, { status: 400 });
    }

    const listIds = updates.map((u) => u.id);
    const { data: existingLists, error: fetchListsError } = await supabase
      .from('lists')
      .select('id, board_id, position')
      .in('id', listIds);

    if (fetchListsError) {
      console.error('[lists/reorder] Failed to fetch lists', fetchListsError);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: fetchListsError.message } },
        { status: 500 }
      );
    }

    const existingMap = new Map(existingLists?.map((list) => [list.id, list]) ?? []);
    const missing = updates.filter((u) => !existingMap.has(u.id));
    missing.forEach((u) => issues.push({ code: 'UNKNOWN_ID', id: u.id }));

    existingMap.forEach((list) => {
      if (list.board_id !== boardId) {
        issues.push({
          code: 'CROSS_BOARD',
          id: list.id,
          expected_board_id: boardId,
          actual_board_id: list.board_id,
        });
      }
    });

    if (issues.length > 0) {
      return NextResponse.json({ error: 'Bad Request', issues }, { status: 400 });
    }

    const snapshot = new Map(
      Array.from(existingMap.entries()).map(([id, list]) => [id, list.position])
    );

    for (const update of updates) {
      const { error: updateError } = await supabase
        .from('lists')
        .update({ position: update.position, updated_at: new Date().toISOString() })
        .eq('id', update.id)
        .eq('board_id', boardId);

      if (updateError) {
        console.error('[lists/reorder] Update failed', { update, error: updateError });

        await Promise.all(
          Array.from(snapshot.entries()).map(([listId, position]) =>
            supabase
              .from('lists')
              .update({ position })
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

    return NextResponse.json({ ok: true, updated: updates.length }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/boards/[boardId]/lists/reorder:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
