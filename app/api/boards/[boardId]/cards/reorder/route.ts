import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

// Phase 1: Validation + Sequential Update + Rollback
const CardReorderUpdateSchema = z.object({
  id: z.string().min(1),
  position: z.number().int(),
  listId: z.string().min(1).optional(), // optional for cross-list moves
});

const ReorderCardsSchema = z.object({
  updates: z.array(CardReorderUpdateSchema).min(1),
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
 * Phase 1: Position-only reorder API with strict validation and failsafe rollback.
 * - Only updates `position` (and `list_id` if provided for cross-list moves).
 * - Validates: duplicate IDs, existence, board ownership, list ownership.
 * - Sequential updates with snapshot-based rollback on failure.
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

    // 4. Snapshot original positions for rollback
    const originalState = new Map(
      existingCards!.map((card) => [
        card.id,
        { list_id: card.list_id, position: card.position },
      ])
    );

    // 5. Sequential update with failsafe rollback
    let updated = 0;
    try {
      for (const update of updates) {
        const updatePayload: { position: number; list_id?: string } = {
          position: update.position,
        };
        if (update.listId) {
          updatePayload.list_id = update.listId;
        }

        const { error: updateError } = await supabase
          .from('cards')
          .update(updatePayload)
          .eq('id', update.id)
          .eq('board_id', boardId);

        if (updateError) {
          console.error('[cards/reorder] Update failed', {
            payload: update,
            message: updateError.message,
            details: updateError.details,
            hint: updateError.hint,
            code: updateError.code,
          });

          // Attempt rollback
          console.warn('[cards/reorder] Attempting rollback...');
          await Promise.all(
            Array.from(originalState.entries()).map(([cardId, snapshot]) =>
              supabase
                .from('cards')
                .update({ list_id: snapshot.list_id, position: snapshot.position })
                .eq('id', cardId)
                .eq('board_id', boardId)
            )
          );

          return NextResponse.json(
            { error: { code: 'DB_ERROR', message: updateError.message } },
            { status: 500 }
          );
        }
        updated++;
      }
    } catch (error) {
      console.error('[cards/reorder] Unexpected error during update', error);
      // Attempt rollback
      await Promise.all(
        Array.from(originalState.entries()).map(([cardId, snapshot]) =>
          supabase
            .from('cards')
            .update({ list_id: snapshot.list_id, position: snapshot.position })
            .eq('id', cardId)
            .eq('board_id', boardId)
        )
      );
      throw error;
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
