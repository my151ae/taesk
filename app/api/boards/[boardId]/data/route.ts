import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

/**
 * GET /api/boards/[boardId]/data
 *
 * Fetch all lists and cards for a board (aggregated endpoint).
 * Replaces direct Supabase client calls to fix CORS issues.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const { boardId } = await params;
    const supabase = await createServerSupabaseClient();

    // 1. Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // 2. Verify board membership (RLS will also enforce this)
    const { data: membership } = await supabase
      .from('board_members')
      .select('role')
      .eq('board_id', boardId)
      .eq('profile_id', user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Not a board member' } },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // 3. Fetch lists and cards in parallel
    const [listsResult, cardsResult] = await Promise.all([
      supabase
        .from('lists')
        .select('id, title, position, board_id, created_at, updated_at')
        .eq('board_id', boardId)
        .order('position', { ascending: true }),
      supabase
        .from('cards')
        .select('id, title, description, list_id, board_id, position, tags, due_date, priority, assignee_id, short_id, id_short, slug, created_at, updated_at')
        .eq('board_id', boardId)
        .order('position', { ascending: true }),
    ]);

    if (listsResult.error) {
      console.error('Error fetching lists:', listsResult.error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to fetch lists' } },
        { status: 500 }
      );
    }

    if (cardsResult.error) {
      console.error('Error fetching cards:', cardsResult.error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to fetch cards' } },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        lists: listsResult.data || [],
        cards: cardsResult.data || [],
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (error) {
    console.error('Unexpected error in GET /api/boards/[boardId]/data:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
