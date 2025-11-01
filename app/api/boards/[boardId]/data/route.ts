import { Buffer } from 'node:buffer';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { createServerTrace, finalizeServerTrace, measureStep } from '@/lib/metrics/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  let trace = createServerTrace(request.headers, 'board-data');

  const respond = (
    status: number,
    body: Record<string, unknown>,
    traceStatus: 'success' | 'error',
    extra?: Record<string, unknown>
  ) => {
    const metrics = finalizeServerTrace(trace, traceStatus, extra);
    return NextResponse.json(
      { ...body, metrics },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  };

  try {
    const { boardId } = await params;
    trace = createServerTrace(request.headers, 'board-data', { boardId });

    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return respond(
        401,
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        'error',
        { reason: 'unauthenticated' }
      );
    }

    const membershipResult = await measureStep(
      trace,
      'membershipQuery',
      async () =>
        await supabase
          .from('board_members')
          .select('role')
          .eq('board_id', boardId)
          .eq('profile_id', user.id)
          .maybeSingle(),
      {
        countResolver: (result) => (result.data ? 1 : 0),
      }
    );

    if (membershipResult.error) {
      console.error('Error verifying membership:', membershipResult.error);
      return respond(
        500,
        { error: { code: 'DB_ERROR', message: 'Failed to verify membership' } },
        'error',
        {
          reason: 'membership_query_failed',
          supabaseError: membershipResult.error.message,
        }
      );
    }

    if (!membershipResult.data) {
      return respond(
        403,
        { error: { code: 'FORBIDDEN', message: 'Not a board member' } },
        'error',
        { reason: 'membership_missing' }
      );
    }

    const listsPromise = measureStep(
      trace,
      'listsQuery',
      async () =>
        await supabase
          .from('lists')
          .select('id, title, position, board_id, created_at, updated_at')
          .eq('board_id', boardId)
          .order('position', { ascending: true }),
      {
        countResolver: (result) => result.data?.length ?? 0,
      }
    );

    const cardsPromise = measureStep(
      trace,
      'cardsQuery',
      async () =>
        await supabase
          .from('cards')
          .select(
            'id, title, description, list_id, board_id, position, tags, due_date, priority, assignee_id, short_id, id_short, slug, created_at, updated_at'
          )
          .eq('board_id', boardId)
          .order('position', { ascending: true }),
      {
        countResolver: (result) => result.data?.length ?? 0,
      }
    );

    const [listsResult, cardsResult] = await Promise.all([listsPromise, cardsPromise]);

    if (listsResult.error) {
      console.error('Error fetching lists:', listsResult.error);
      return respond(
        500,
        { error: { code: 'DB_ERROR', message: 'Failed to fetch lists' } },
        'error',
        {
          reason: 'lists_query_failed',
          supabaseError: listsResult.error.message,
        }
      );
    }

    if (cardsResult.error) {
      console.error('Error fetching cards:', cardsResult.error);
      return respond(
        500,
        { error: { code: 'DB_ERROR', message: 'Failed to fetch cards' } },
        'error',
        {
          reason: 'cards_query_failed',
          supabaseError: cardsResult.error.message,
        }
      );
    }

    const lists = listsResult.data ?? [];
    const cards = cardsResult.data ?? [];
    const payload = { lists, cards };
    const payloadSizeBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');

    return respond(
      200,
      payload,
      'success',
      {
        listsCount: lists.length,
        cardsCount: cards.length,
        payloadSizeBytes,
      }
    );
  } catch (error) {
    console.error('Unexpected error in GET /api/boards/[boardId]/data:', error);
    return respond(
      500,
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      'error',
      {
        reason: 'unexpected_error',
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}
