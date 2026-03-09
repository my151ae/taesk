import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { normalizeChecklist, EMPTY_CHECKLIST } from '@/lib/checklist';
import { isMissingColumnError } from '@/lib/server/card-mutation';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const getHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) => {
  const supabase = await createServerSupabaseClient();
  const { cardId } = await params;

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
    .select(`
        id, short_id, id_short, slug, title, checklist, tags, content, excerpt,
        list_id, board_id, position, user_id,
        due_date, due_start, due_end, due_bucket, due_bucket_position, started_at,
        start_reminder_enabled, start_reminder_minutes, end_reminder_enabled, end_reminder_minutes,
        checked, assignee_id, assignee_ids, assigned_to,
        created_at, updated_at, duration,
        calendar_sync ( status, last_synced_at, google_event_id, last_google_event_id )
      `)
    .eq('short_id', cardId)
    .maybeSingle();

  let effectiveCard = card;
  let effectiveCardError = cardError;

  if (isMissingColumnError(cardError, 'started_at')) {
    const fallback = await supabase
      .from('cards')
      .select(`
        id, short_id, id_short, slug, title, checklist, tags, content, excerpt,
        list_id, board_id, position, user_id,
        due_date, due_start, due_end, due_bucket, due_bucket_position,
        start_reminder_enabled, start_reminder_minutes, end_reminder_enabled, end_reminder_minutes,
        checked, assignee_id, assignee_ids, assigned_to,
        created_at, updated_at, duration,
        calendar_sync ( status, last_synced_at, google_event_id, last_google_event_id )
      `)
      .eq('short_id', cardId)
      .maybeSingle();

    effectiveCard = fallback.data
      ? { ...fallback.data, started_at: null }
      : null;
    effectiveCardError = fallback.error;
  }

  if (effectiveCardError) {
    console.error('[cards:get] failed to load card', effectiveCardError);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: effectiveCardError.message } },
      { status: 500 }
    );
  }

  if (!effectiveCard) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Card not found' } },
      { status: 404 }
    );
  }

  const { data: membership } = await supabase
    .from('board_members')
    .select('role')
    .eq('board_id', effectiveCard.board_id)
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
    .eq('id', effectiveCard.board_id)
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
    .eq('board_id', effectiveCard.board_id);

  const profiles = (members || [])
    .map((member) => member.profiles)
    .filter(Boolean);

  const normalizedCard = effectiveCard
    ? {
      ...effectiveCard,
      checklist: normalizeChecklist(effectiveCard.checklist ?? EMPTY_CHECKLIST),
      content: effectiveCard.content ?? null,
    }
    : null;

  return NextResponse.json({ card: normalizedCard, board, profiles }, { status: 200 });
};

export const GET = withErrorHandling(getHandler, 'cards-by-short-id-get');
