import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const supabase = await createServerSupabaseClient();
  const { cardId } = await params;

  try {
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

    const { data: card, error: cardError } = await supabase
      .from('cards')
      .select('*')
      .eq('short_id', cardId)
      .maybeSingle();

    if (cardError) {
      console.error('[cards:get] failed to load card', cardError);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: cardError.message } },
        { status: 500 }
      );
    }

    if (!card) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Card not found' } },
        { status: 404 }
      );
    }

    const { data: membership } = await supabase
      .from('board_members')
      .select('role')
      .eq('board_id', card.board_id)
      .eq('profile_id', user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Not a board member' } },
        { status: 403 }
      );
    }

    const { data: board } = await supabase
      .from('boards')
      .select('id, name, description, short_id, id_short, slug')
      .eq('id', card.board_id)
      .maybeSingle();

    const { data: members } = await supabase
      .from('board_members')
      .select(`
        profile_id,
        role,
        profiles:profile_id (
          id,
          username,
          display_name,
          full_name,
          avatar_url,
          email
        )
      `)
      .eq('board_id', card.board_id);

    const profiles = (members || [])
      .map((member) => member.profiles)
      .filter(Boolean);

    return NextResponse.json(
      {
        card,
        board,
        profiles,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Unexpected error in GET /api/cards/[cardId]:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
