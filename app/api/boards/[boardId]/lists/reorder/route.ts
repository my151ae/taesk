import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

// Phase 1: Validation + Sequential Update + Rollback
const ReorderListsSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string().min(1),
      position: z.number().int(),
    })
  ).min(1),
});

interface ValidationIssue {
  code: string;
  id?: string;
  expectedBoardId?: string;
  actualBoardId?: string;
}

/**
 * PATCH /api/boards/[boardId]/lists/reorder
 *
 * Phase 1: Position-only reorder API with strict validation and failsafe rollback.
 * - Only updates `position`.
 * - Validates: duplicate IDs, existence, board ownership.
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
    const parsed = ReorderListsSchema.safeParse(body);

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

    // 2. Fetch existing lists and validate existence + board ownership
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

    const foundIds = new Set(existingLists?.map((list) => list.id) ?? []);
    const unknownIds = updates.filter((u) => !foundIds.has(u.id));
    unknownIds.forEach((u) => issues.push({ code: 'UNKNOWN_ID', id: u.id }));

    // Check board ownership
    existingLists?.forEach((list) => {
      if (list.board_id !== boardId) {
        issues.push({
          code: 'CROSS_BOARD',
          id: list.id,
          expectedBoardId: boardId,
          actualBoardId: list.board_id,
        });
      }
    });

    if (issues.length > 0) {
      const durationMs = Date.now() - startTime;
      logReorderEvent(boardId, user.id, updates.length, 0, durationMs, issues);
      return NextResponse.json({ error: 'Bad Request', issues }, { status: 400 });
    }

    // 3. Snapshot original positions for rollback
    const originalState = new Map(
      existingLists!.map((list) => [list.id, list.position])
    );

    // 4. Sequential update with failsafe rollback
    let updated = 0;
    try {
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('lists')
          .update({ position: update.position })
          .eq('id', update.id)
          .eq('board_id', boardId);

        if (updateError) {
          console.error('[lists/reorder] Update failed', {
            payload: update,
            message: updateError.message,
            details: updateError.details,
            hint: updateError.hint,
            code: updateError.code,
          });

          // Attempt rollback
          console.warn('[lists/reorder] Attempting rollback...');
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
        updated++;
      }
    } catch (error) {
      console.error('[lists/reorder] Unexpected error during update', error);
      // Attempt rollback
      await Promise.all(
        Array.from(originalState.entries()).map(([listId, originalPosition]) =>
          supabase
            .from('lists')
            .update({ position: originalPosition })
            .eq('id', listId)
            .eq('board_id', boardId)
        )
      );
      throw error;
    }

    const durationMs = Date.now() - startTime;

    // 5. Log activity
    supabase
      .from('activity_logs')
      .insert({
        board_id: boardId,
        user_id: user.id,
        action: 'updated',
        entity_type: 'list',
        entity_id: boardId,
        entity_title: 'Lists reordered',
        details: { count: updated },
      })
      .then(({ error: logError }) => {
        if (logError) console.error('[lists/reorder] Activity log failed:', logError);
      });

    // 6. Structured logging
    logReorderEvent(boardId, user.id, updates.length, updated, durationMs, []);

    return NextResponse.json(
      { updated, unchanged: 0, durationMs },
      { status: 200 }
    );
  } catch (error) {
    console.error('[lists/reorder] Unexpected error:', error);
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
      event: 'lists.reorder',
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
