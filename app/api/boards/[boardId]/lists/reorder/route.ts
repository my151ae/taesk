import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';
import crypto from 'crypto';

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

/**
 * Generate SHA-256 hash of payload for logging and debugging
 */
function hashPayload(updates: Array<{ id: string; position: number }>): string {
  const payload = JSON.stringify(updates.map(u => ({ id: u.id, pos: u.position })));
  return crypto.createHash('sha256').update(payload).digest('hex').substring(0, 12);
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
      const payloadHash = hashPayload(updates);
      // Log validation errors with issues (max 5 for brevity)
      console.error(
        JSON.stringify({
          event: 'lists.reorder',
          severity: 'warning',
          status: 'validation_error',
          boardId,
          updatesCount: updates.length,
          payloadHash,
          issues: issues.slice(0, 5),
          issuesTotal: issues.length,
        })
      );
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Bad Request' }, issues },
        { status: 400 }
      );
    }

    const listIds = updates.map((u) => u.id);
    const { data: existingLists, error: fetchListsError } = await supabase
      .from('lists')
      .select('id, board_id, position')
      .in('id', listIds);

    if (fetchListsError) {
      console.error(
        JSON.stringify({
          event: 'lists.reorder',
          severity: 'error',
          status: 'db_error',
          boardId,
          error: fetchListsError.message,
          phase: 'fetch_lists',
        })
      );
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
      const payloadHash = hashPayload(updates);
      // Log validation errors with issues (max 5 for brevity)
      console.error(
        JSON.stringify({
          event: 'lists.reorder',
          severity: 'warning',
          status: 'validation_error',
          boardId,
          updatesCount: updates.length,
          payloadHash,
          issues: issues.slice(0, 5),
          issuesTotal: issues.length,
        })
      );
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Bad Request' }, issues },
        { status: 400 }
      );
    }

    // Phase 2: Use database transaction with advisory lock
    const startTime = Date.now();
    const lockKey = hashBoardId(boardId);

    const { data, error: rpcError } = await supabase.rpc('reorder_lists_tx', {
      p_board_id: boardId,
      p_lock_key: lockKey,
      p_updates: updates.map((u) => ({
        id: u.id,
        position: u.position,
      })),
    });

    if (rpcError) {
      const payloadHash = hashPayload(updates);
      console.error(
        JSON.stringify({
          event: 'lists.reorder',
          severity: 'error',
          status: 'transaction_failed',
          boardId,
          updatesCount: updates.length,
          payloadHash,
          error: rpcError.message,
          durationMs: Date.now() - startTime,
        })
      );
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: rpcError.message } },
        { status: 500 }
      );
    }

    const durationMs = Date.now() - startTime;
    const updatedCount = data?.updated_count || 0;
    const unchangedCount = updates.length - updatedCount;
    const payloadHash = hashPayload(updates);

    console.log(
      JSON.stringify({
        event: 'lists.reorder',
        severity: 'info',
        status: 'success',
        boardId,
        actorId: user.id,
        updatesCount: updates.length,
        updated: updatedCount,
        unchanged: unchangedCount,
        durationMs,
        payloadHash,
      })
    );

    return NextResponse.json(
      { updated: updatedCount, unchanged: unchangedCount, durationMs },
      { status: 200 }
    );
  } catch (error) {
    console.error('Unexpected error in PATCH /api/boards/[boardId]/lists/reorder:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
