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

/**
 * Hash board ID to a 32-bit integer for PostgreSQL advisory lock
 */
function hashBoardId(boardId: string): number {
  let hash = 0;
  for (let i = 0; i < boardId.length; i++) {
    const char = boardId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
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

    // Phase 2: Use database transaction with advisory lock
    const startTime = Date.now();
    const lockKey = hashBoardId(boardId);

    const { data, error: rpcError } = await supabase.rpc('reorder_cards_tx', {
      p_board_id: boardId,
      p_lock_key: lockKey,
      p_updates: updates.map((u) => ({
        id: u.id,
        position: u.position,
        list_id: u.list_id || null,
      })),
    });

    if (rpcError) {
      console.error('[cards/reorder] Transaction failed', rpcError);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: rpcError.message } },
        { status: 500 }
      );
    }

    const durationMs = Date.now() - startTime;
    const updatedCount = data?.updated_count || 0;
    const unchangedCount = updates.length - updatedCount;

    console.log(
      JSON.stringify({
        event: 'cards.reorder',
        boardId,
        actorId: user.id,
        updated: updatedCount,
        unchanged: unchangedCount,
        durationMs,
      })
    );

    return NextResponse.json(
      { updated: updatedCount, unchanged: unchangedCount, durationMs },
      { status: 200 }
    );
  } catch (error) {
    console.error('Unexpected error in PATCH /api/boards/[boardId]/cards/reorder:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
