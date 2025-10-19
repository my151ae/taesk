import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

/**
 * POST /api/boards/[boardId]/lists/renumber
 *
 * Renumbers all lists in a board using position gap strategy (1000, 1010, 1020, ...)
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

    // Execute renumbering
    const { data, error: rpcError } = await supabase.rpc('renumber_list_positions', {
      p_board_id: boardId,
    });

    if (rpcError) {
      console.error('[lists/renumber] Renumbering failed', rpcError);
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
        entity_type: 'list',
        entity_id: boardId,
        entity_title: 'Lists renumbered',
        details: { count: updatedCount },
      })
      .then(({ error: logError }) => {
        if (logError) console.error('[lists/renumber] Activity log failed:', logError);
      });

    console.log(
      JSON.stringify({
        event: 'lists.renumber',
        boardId,
        actorId: user.id,
        updated: updatedCount,
        durationMs,
      })
    );

    return NextResponse.json({ updated: updatedCount, durationMs }, { status: 200 });
  } catch (error) {
    console.error('[lists/renumber] Unexpected error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
