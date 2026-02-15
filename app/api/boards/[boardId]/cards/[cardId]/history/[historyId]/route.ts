import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ boardId: string; cardId: string; historyId: string }> }
) {
  try {
    const supabase = await createServerSupabaseClient();
    const { boardId, cardId, historyId } = await params;

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
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

    if (!membership) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Not a board member' } },
        { status: 403 }
      );
    }

    const { data: card } = await supabase
      .from('cards')
      .select('id, board_id')
      .eq('id', cardId)
      .maybeSingle();

    if (!card || card.board_id !== boardId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Card not found' } },
        { status: 404 }
      );
    }

    const { data: history, error } = await supabase
      .from('card_content_history')
      .select(`
        id,
        card_id,
        board_id,
        content,
        excerpt,
        saved_by,
        created_at,
        saved_by_profile:saved_by (
          id,
          username,
          display_name,
          full_name,
          avatar_url,
          email
        )
      `)
      .eq('id', historyId)
      .eq('board_id', boardId)
      .eq('card_id', cardId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }
    if (!history) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'History not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json({ history }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in GET /api/boards/[boardId]/cards/[cardId]/history/[historyId]:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
