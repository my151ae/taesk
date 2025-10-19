import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

const RenumberSchema = z.object({
  listId: z.string().uuid(),
});

/**
 * POST /api/boards/[boardId]/cards/renumber
 *
 * Renumbers all cards in a specific list using position gap strategy (1000, 1010, 1020, ...)
 * Should be called when position density is detected (gaps <= 2).
 */
export async function POST(
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

    // Permission check (owner/editor only)
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
    const parsed = RenumberSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', details: parsed.error.flatten() } },
        { status: 400 }
      );
    }

    const { listId } = parsed.data;

    // Verify list belongs to board
    const { data: list, error: listError } = await supabase
      .from('lists')
      .select('id, board_id')
      .eq('id', listId)
      .maybeSingle();

    if (listError || !list || list.board_id !== boardId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'List not found or does not belong to this board' } },
        { status: 404 }
      );
    }

    // Execute renumbering
    const { data, error: rpcError } = await supabase.rpc('renumber_card_positions', {
      p_board_id: boardId,
      p_list_id: listId,
    });

    if (rpcError) {
      console.error('[cards/renumber] Renumbering failed', rpcError);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: rpcError.message } },
        { status: 500 }
      );
    }

    const durationMs = Date.now() - startTime;
    const updatedCount = data?.updated_count || 0;

    // Log activity
    supabase
      .from('activity_logs')
      .insert({
        board_id: boardId,
        user_id: user.id,
        action: 'updated',
        entity_type: 'card',
        entity_id: listId,
        entity_title: 'Cards renumbered',
        details: { listId, count: updatedCount },
      })
      .then(({ error: logError }) => {
        if (logError) console.error('[cards/renumber] Activity log failed:', logError);
      });

    console.log(
      JSON.stringify({
        event: 'cards.renumber',
        boardId,
        listId,
        actorId: user.id,
        updated: updatedCount,
        durationMs,
      })
    );

    return NextResponse.json({ updated: updatedCount, durationMs }, { status: 200 });
  } catch (error) {
    console.error('[cards/renumber] Unexpected error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
