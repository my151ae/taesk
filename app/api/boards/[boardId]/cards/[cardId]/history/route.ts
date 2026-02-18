import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { deriveExcerptFromContent, normalizeContent } from '@/lib/tiptap';
import { withErrorHandling } from '@/lib/server/with-error-handling';

async function ensureBoardAccess(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  boardId: string,
  cardId: string,
  userId: string,
  requireWrite: boolean
) {
  const { data: card, error: cardError } = await supabase
    .from('cards')
    .select('id, board_id')
    .eq('id', cardId)
    .maybeSingle();

  if (cardError) {
    return { ok: false as const, status: 500, message: cardError.message };
  }
  if (!card || card.board_id !== boardId) {
    return { ok: false as const, status: 404, message: 'Card not found' };
  }

  const { data: membership, error: memberError } = await supabase
    .from('board_members')
    .select('role')
    .eq('board_id', boardId)
    .eq('profile_id', userId)
    .maybeSingle();

  if (memberError) {
    return { ok: false as const, status: 500, message: memberError.message };
  }
  if (!membership) {
    return { ok: false as const, status: 403, message: 'Not a board member' };
  }
  if (requireWrite && membership.role !== 'owner' && membership.role !== 'editor') {
    return { ok: false as const, status: 403, message: 'Insufficient permissions' };
  }
  return { ok: true as const };
}

const getHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> }
) => {
    const supabase = await createServerSupabaseClient();
    const { boardId, cardId } = await params;

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

    const access = await ensureBoardAccess(supabase, boardId, cardId, user.id, false);
    if (!access.ok) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: access.message } },
        { status: access.status }
      );
    }

    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 50;

    const { data: history, error } = await supabase
      .from('card_content_history')
      .select(`
        id,
        card_id,
        board_id,
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
      .eq('board_id', boardId)
      .eq('card_id', cardId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({ history: history ?? [] }, { status: 200 });
};

const postHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> }
) => {
    const supabase = await createServerSupabaseClient();
    const { boardId, cardId } = await params;

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

    const access = await ensureBoardAccess(supabase, boardId, cardId, user.id, true);
    if (!access.ok) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: access.message } },
        { status: access.status }
      );
    }

    const body = await request.json().catch(() => ({}));
    if (!body || !('content' in body)) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'content is required' } },
        { status: 422 }
      );
    }

    const content = normalizeContent(body.content);
    const excerpt = deriveExcerptFromContent(content);

    const { data: inserted, error: insertError } = await supabase
      .from('card_content_history')
      .insert({
        card_id: cardId,
        board_id: boardId,
        content,
        excerpt,
        saved_by: user.id,
      })
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
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: insertError.message } },
        { status: 500 }
      );
    }

    const { data: staleRows, error: staleError } = await supabase
      .from('card_content_history')
      .select('id')
      .eq('card_id', cardId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(50, 5000);

    if (staleError) {
      console.error('[history] failed to collect stale rows', staleError);
    } else if (staleRows && staleRows.length > 0) {
      const staleIds = staleRows.map((row) => row.id);
      const { error: deleteError } = await supabase
        .from('card_content_history')
        .delete()
        .in('id', staleIds);
      if (deleteError) {
        console.error('[history] failed to prune stale rows', deleteError);
      }
    }

    return NextResponse.json({ history: inserted }, { status: 201 });
};

export const GET = withErrorHandling(getHandler, 'card-history-get');
export const POST = withErrorHandling(postHandler, 'card-history-post');
