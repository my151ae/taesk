import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

// Phase 2: Transaction + Advisory Lock + CTE Bulk Update
const CardReorderUpdateSchema = z.object({
  id: z.string().min(1),
  position: z.number().int(),
  listId: z.string().min(1).optional(), // optional for cross-list moves
});

const ReorderCardsSchema = z.object({
  updates: z.array(CardReorderUpdateSchema).min(1).max(1000), // limit payload size
});

interface ValidationIssue {
  code: string;
  id?: string;
  listId?: string;
  expectedBoardId?: string;
  actualBoardId?: string;
}

/**
 * PATCH /api/boards/[boardId]/cards/reorder
 *
 * Phase 2: Position-only reorder API with transactions and bulk updates.
 * - Only updates `position` (and `list_id` if provided for cross-list moves).
 * - Validates: duplicate IDs, existence, board ownership, list ownership.
 * - Uses PostgreSQL transactions with advisory locks for consistency.
 * - Bulk updates via CTE for performance.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  const startTime = Date.now();
  const { boardId } = await params;

  try {
    const supabase = await createServerSupabaseClient();

    // Auth check
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401 }
      );
    }

    // Permission check
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

    // Parse request body
    const body = await request.json();
    const parsed = ReorderCardsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          issues: [{ code: 'INVALID_SCHEMA', details: parsed.error.flatten() }],
        },
        { status: 400 }
      );
    }

    const updates = parsed.data.updates;
    const issues: ValidationIssue[] = [];

    // 1. Check duplicate IDs
    const idSet = new Set<string>();
    for (const update of updates) {
      if (idSet.has(update.id)) {
        issues.push({ code: 'DUPLICATE_ID', id: update.id });
      }
      idSet.add(update.id);
    }

    if (issues.length > 0) {
      const durationMs = Date.now() - startTime;
      logReorderEvent(boardId, user.id, updates.length, 0, durationMs, issues);
      return NextResponse.json({ error: 'Bad Request', issues }, { status: 400 });
    }

    // 2. Fetch existing cards and validate existence + board ownership
    const cardIds = updates.map((u) => u.id);
    const { data: existingCards, error: fetchCardsError } = await supabase
      .from('cards')
      .select('id, board_id, list_id, position')
      .in('id', cardIds);

    if (fetchCardsError) {
      console.error('[cards/reorder] Failed to fetch current card state', fetchCardsError);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: fetchCardsError.message } },
        { status: 500 }
      );
    }

    const foundIds = new Set(existingCards?.map((card) => card.id) ?? []);
    const unknownIds = updates.filter((u) => !foundIds.has(u.id));
    unknownIds.forEach((u) => issues.push({ code: 'UNKNOWN_ID', id: u.id }));

    // Check board ownership
    existingCards?.forEach((card) => {
      if (card.board_id !== boardId) {
        issues.push({
          code: 'CROSS_BOARD',
          id: card.id,
          expectedBoardId: boardId,
          actualBoardId: card.board_id,
        });
      }
    });

    // 3. Validate listId ownership (if provided)
    const listIds = Array.from(new Set(updates.filter((u) => u.listId).map((u) => u.listId!)));
    if (listIds.length > 0) {
      const { data: targetLists, error: fetchListsError } = await supabase
        .from('lists')
        .select('id, board_id')
        .in('id', listIds);

      if (fetchListsError) {
        console.error('[cards/reorder] Failed to verify list ownership', fetchListsError);
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: fetchListsError.message } },
          { status: 500 }
        );
      }

      const foundListIds = new Set(targetLists?.map((list) => list.id) ?? []);
      targetLists?.forEach((list) => {
        if (list.board_id !== boardId) {
          updates
            .filter((u) => u.listId === list.id)
            .forEach((u) => {
              issues.push({ code: 'FOREIGN_LIST', id: u.id, listId: list.id });
            });
        }
      });

      listIds.forEach((listId) => {
        if (!foundListIds.has(listId)) {
          updates
            .filter((u) => u.listId === listId)
            .forEach((u) => {
              issues.push({ code: 'FOREIGN_LIST', id: u.id, listId });
            });
        }
      });
    }

    if (issues.length > 0) {
      const durationMs = Date.now() - startTime;
      logReorderEvent(boardId, user.id, updates.length, 0, durationMs, issues);
      return NextResponse.json({ error: 'Bad Request', issues }, { status: 400 });
    }

    // 4. Execute bulk update in transaction with advisory lock
    let updated = 0;
    try {
      // Acquire advisory lock based on board ID hash
      const lockKey = hashBoardId(boardId);

      // Build CTE bulk update query
      const values = updates
        .map((u) => {
          const listIdValue = u.listId ? `'${u.listId}'` : 'NULL';
          return `('${u.id}', ${u.position}, ${listIdValue})`;
        })
        .join(', ');

      // Use PostgreSQL transaction with advisory lock + CTE bulk update
      const { data, error: rpcError } = await supabase.rpc('reorder_cards_tx', {
        p_board_id: boardId,
        p_lock_key: lockKey,
        p_updates: updates.map((u) => ({
          id: u.id,
          position: u.position,
          list_id: u.listId || null,
        })),
      });

      if (rpcError) {
        console.error('[cards/reorder] Transaction failed', {
          message: rpcError.message,
          details: rpcError.details,
          hint: rpcError.hint,
          code: rpcError.code,
        });

        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: rpcError.message } },
          { status: 500 }
        );
      }

      updated = data?.updated_count || 0;
    } catch (error) {
      console.error('[cards/reorder] Unexpected error during transaction', error);
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Transaction failed' } },
        { status: 500 }
      );
    }

    const durationMs = Date.now() - startTime;

    // 6. Log activity
    supabase
      .from('activity_logs')
      .insert({
        board_id: boardId,
        user_id: user.id,
        action: 'updated',
        entity_type: 'card',
        entity_id: boardId,
        entity_title: 'Cards reordered',
        details: { count: updated },
      })
      .then(({ error: logError }) => {
        if (logError) console.error('[cards/reorder] Activity log failed:', logError);
      });

    // 7. Structured logging
    logReorderEvent(boardId, user.id, updates.length, updated, durationMs, []);

    return NextResponse.json(
      { updated, unchanged: 0, durationMs },
      { status: 200 }
    );
  } catch (error) {
    console.error('[cards/reorder] Unexpected error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

function logReorderEvent(
  boardId: string,
  actorId: string,
  updates: number,
  changed: number,
  durationMs: number,
  issues: ValidationIssue[]
) {
  console.log(
    JSON.stringify({
      event: 'cards.reorder',
      boardId,
      actorId,
      updates,
      changed,
      durationMs,
      issues,
      hint: issues.length > 0 ? 'Validation failed' : '',
    })
  );
}

/**
 * Hash board ID to get advisory lock key (32-bit integer)
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
