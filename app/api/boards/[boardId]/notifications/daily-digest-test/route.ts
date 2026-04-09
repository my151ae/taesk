import { NextRequest, NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase';
import {
  getBoardMembership,
  requireAuthenticatedUser,
  validateMutationRequestOrigin,
} from '@/lib/server/api-security';
import { createServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin';
import { withErrorHandling } from '@/lib/server/with-error-handling';
import {
  buildBoardTail,
  buildDigestItems,
  getJstDate,
  type DailyDigestBoard,
  type DailyDigestSourceCard,
} from '@/lib/shared/daily-digest';
import { formatDailyDigestPushCopy } from '@/lib/shared/notification-push';

const postHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) => {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return originError;
  }

  const { boardId } = await params;
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await getBoardMembership(supabase, boardId, user.id);
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createServiceRoleSupabaseClient();

  const [{ data: board, error: boardError }, { data: cards, error: cardsError }] = await Promise.all([
    admin
      .from('boards')
      .select('id, name, short_id, id_short, slug')
      .eq('id', boardId)
      .maybeSingle(),
    admin
      .from('cards')
      .select('id, title, due_date, due_start, due_end, short_id, slug')
      .eq('board_id', boardId)
      .is('deleted_at', null)
      .eq('checked', false)
      .not('due_date', 'is', null),
  ]);

  if (boardError || !board) {
    console.error('Failed to load board for daily digest test:', boardError);
    return NextResponse.json({ error: 'Failed to load board' }, { status: 500 });
  }

  if (cardsError) {
    console.error('Failed to load cards for daily digest test:', cardsError);
    return NextResponse.json({ error: 'Failed to load cards' }, { status: 500 });
  }

  const summaryDate = getJstDate(new Date());
  const digestItems = buildDigestItems({
    cards: (cards ?? []) as DailyDigestSourceCard[],
    summaryDate,
    includeOverdue: true,
  });
  const todayCount = digestItems.filter((item) => item.kind === 'today').length;
  const overdueCount = digestItems.filter((item) => item.kind === 'overdue').length;
  const totalCount = digestItems.length;
  const boardInfo = board as DailyDigestBoard;
  const pushCopy = formatDailyDigestPushCopy({
    boardName: boardInfo.name,
    todayCount,
    overdueCount,
    topItemTitle: digestItems[0]?.title ?? '',
  });
  const payload = {
    message: pushCopy.body,
    board_id: boardInfo.id,
    board_name: boardInfo.name,
    board_short_id: boardInfo.short_id,
    board_slug: buildBoardTail(boardInfo),
    summary_date: summaryDate,
    today_count: todayCount,
    overdue_count: overdueCount,
    total_count: totalCount,
    top_items: digestItems.slice(0, 3),
    manual_test: true,
  };

  const [{ data: prefs, error: prefsError }, { count: subscriptionCount, error: subscriptionError }] = await Promise.all([
    admin
      .from('notification_preferences')
      .select('web_push_enabled')
      .eq('profile_id', user.id)
      .maybeSingle(),
    admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', user.id),
  ]);

  if (prefsError) {
    console.error('Failed to load notification preferences for daily digest test:', prefsError);
    return NextResponse.json({ error: 'Failed to load notification preferences' }, { status: 500 });
  }

  if (subscriptionError) {
    console.error('Failed to load push subscriptions for daily digest test:', subscriptionError);
    return NextResponse.json({ error: 'Failed to load push subscriptions' }, { status: 500 });
  }

  const pushReason = prefs?.web_push_enabled !== true
    ? 'disabled'
    : (subscriptionCount ?? 0) > 0
      ? 'enabled'
      : 'no_subscription';

  const dedupeKey = `daily_digest_test:${user.id}:${boardId}:${Date.now()}`;
  const { data: inserted, error: insertError } = await admin
    .from('notifications')
    .insert({
      recipient_id: user.id,
      type: 'daily_digest',
      payload,
      dedupe_key: dedupeKey,
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    console.error('Failed to insert daily digest test notification:', insertError);
    return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    notificationId: inserted.id,
    title: pushCopy.title,
    body: pushCopy.body,
    titleLength: pushCopy.titleLength,
    bodyLength: pushCopy.bodyLength,
    pushEligible: pushReason === 'enabled',
    pushReason,
  });
};

export const POST = withErrorHandling(postHandler, 'board-daily-digest-test-post');
