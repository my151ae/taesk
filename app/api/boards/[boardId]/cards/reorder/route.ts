import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

const CardReorderUpdateSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int(),
  list_id: z.string().uuid().optional(),
});

const ReorderCardsSchema = z.object({
  updates: z.array(CardReorderUpdateSchema).min(1),
});

interface ValidationIssue {
  code: string;
  id?: string;
  list_id?: string;
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
    const parsed = ReorderCardsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Validation failed', details: parsed.error.flatten() } },
        { status: 400 }
      );
    }

    const updates = parsed.data.updates;

    const issues: ValidationIssue[] = [];
    const seenIds = new Set<string>();

    for (const update of updates) {
      if (seenIds.has(update.id)) {
        issues.push({ code: 'DUPLICATE_ID', id: update.id });
      }
      seenIds.add(update.id);
    }

    if (issues.length > 0) {
      return NextResponse.json({ error: 'Bad Request', issues }, { status: 400 });
    }

    const cardIds = updates.map((u) => u.id);
    const { data: existingCards, error: fetchCardsError } = await supabase
      .from('cards')
      .select('id, board_id, list_id, position')
      .in('id', cardIds);

    if (fetchCardsError) {
      console.error('[cards/reorder] Failed to fetch cards', fetchCardsError);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: fetchCardsError.message } },
        { status: 500 }
      );
    }

    const existingMap = new Map(existingCards?.map((card) => [card.id, card]) ?? []);
    const missing = updates.filter((u) => !existingMap.has(u.id));

    missing.forEach((u) => issues.push({ code: 'UNKNOWN_ID', id: u.id }));

    existingMap.forEach((card) => {
      if (card.board_id !== boardId) {
        issues.push({
          code: 'CROSS_BOARD',
          id: card.id,
          expected_board_id: boardId,
          actual_board_id: card.board_id,
        });
      }
    });

    const targetListIds = Array.from(new Set(updates.filter((u) => u.list_id).map((u) => u.list_id!)));

    if (targetListIds.length > 0) {
      const { data: lists, error: fetchListsError } = await supabase
        .from('lists')
        .select('id, board_id')
        .in('id', targetListIds);

      if (fetchListsError) {
        console.error('[cards/reorder] Failed to fetch lists', fetchListsError);
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: fetchListsError.message } },
          { status: 500 }
        );
      }

      const listMap = new Map(lists?.map((list) => [list.id, list]) ?? []);

      targetListIds.forEach((listId) => {
        const list = listMap.get(listId);
        if (!list) {
          issues.push({ code: 'UNKNOWN_LIST', list_id: listId });
          return;
        }
        if (list.board_id !== boardId) {
          issues.push({
            code: 'FOREIGN_LIST',
            list_id: listId,
            expected_board_id: boardId,
            actual_board_id: list.board_id,
          });
        }
      });
    }

    if (issues.length > 0) {
      return NextResponse.json({ error: 'Bad Request', issues }, { status: 400 });
    }

    const originalSnapshot = new Map(
      Array.from(existingMap.entries()).map(([id, card]) => [id, { list_id: card.list_id, position: card.position }])
    );

    for (const update of updates) {
      const current = existingMap.get(update.id);
      if (!current) continue;

      const nextListId = update.list_id ?? current.list_id;

      const { error: updateError } = await supabase
        .from('cards')
        .update({
          position: update.position,
          list_id: nextListId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', update.id)
        .eq('board_id', boardId);

      if (updateError) {
        console.error('[cards/reorder] Update failed', { update, error: updateError });

        await Promise.all(
          Array.from(originalSnapshot.entries()).map(([cardId, snapshot]) =>
            supabase
              .from('cards')
              .update({ position: snapshot.position, list_id: snapshot.list_id })
              .eq('id', cardId)
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
    console.error('Unexpected error in PATCH /api/boards/[boardId]/cards/reorder:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
