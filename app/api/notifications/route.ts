import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { Notification } from '@/lib/supabase';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const DEFAULT_NOTIFICATIONS_PAGE_SIZE = 20;
const MAX_NOTIFICATIONS_PAGE_SIZE = 100;

type NotificationsCursor = {
  created_at: string;
  id: string;
};

function parseLimit(searchParams: URLSearchParams) {
  const rawLimit = searchParams.get('limit');
  if (!rawLimit) return DEFAULT_NOTIFICATIONS_PAGE_SIZE;

  const parsedLimit = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return null;
  }

  return Math.min(parsedLimit, MAX_NOTIFICATIONS_PAGE_SIZE);
}

function encodeCursor(notification: Pick<Notification, 'created_at' | 'id'>) {
  return Buffer.from(
    JSON.stringify({ created_at: notification.created_at, id: notification.id }),
    'utf-8'
  ).toString('base64url');
}

function decodeCursor(cursor: string): NotificationsCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as Partial<NotificationsCursor>;
    if (typeof parsed.created_at !== 'string' || typeof parsed.id !== 'string') {
      return null;
    }
    return {
      created_at: parsed.created_at,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}

// GET /api/notifications - List notifications for current user
const getHandler = async (request: NextRequest) => {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = parseLimit(request.nextUrl.searchParams);
  if (limit === null) {
    return NextResponse.json({ error: 'Invalid limit' }, { status: 400 });
  }

  const before = request.nextUrl.searchParams.get('before');
  const cursor = before ? decodeCursor(before) : null;
  if (before && !cursor) {
    return NextResponse.json({ error: 'Invalid before cursor' }, { status: 400 });
  }

  let notificationsQuery = supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    notificationsQuery = notificationsQuery.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
    );
  }

  const [
    { data: notificationsResult, error: notificationsError },
    { count: unreadCount, error: unreadCountError },
  ] = await Promise.all([
    notificationsQuery,
    supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_id', user.id)
      .is('read_at', null),
  ]);

  if (notificationsError) {
    console.error('Error fetching notifications:', notificationsError);
    return NextResponse.json({ error: notificationsError.message }, { status: 500 });
  }

  if (unreadCountError) {
    console.error('Error fetching unread notifications count:', unreadCountError);
    return NextResponse.json({ error: unreadCountError.message }, { status: 500 });
  }

  const notifications = notificationsResult ?? [];
  const hasMore = notifications.length > limit;
  const pageNotifications = hasMore ? notifications.slice(0, limit) : notifications;
  const nextCursor = hasMore && pageNotifications.length > 0
    ? encodeCursor(pageNotifications[pageNotifications.length - 1])
    : null;

  return NextResponse.json({
    notifications: pageNotifications,
    unreadCount: unreadCount ?? 0,
    hasMore,
    nextCursor,
  });
};

// POST /api/notifications - Create a notification
const postHandler = async (request: NextRequest) => {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

    const body = await request.json();
    const { recipient_id, type, payload } = body as {
      recipient_id: string;
      type: string;
      payload: Record<string, unknown>;
    };

    if (!recipient_id || !type || !payload) {
      return NextResponse.json(
        { error: 'recipient_id, type, and payload are required' },
        { status: 400 }
      );
    }

    if (recipient_id !== user.id) {
      return NextResponse.json(
        { error: 'Cannot create notifications for other users' },
        { status: 403 }
      );
    }

    // Insert notification
    const { data: notification, error } = await supabase
      .from('notifications')
      .insert({
        recipient_id,
        type,
        payload,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating notification:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

  return NextResponse.json({ notification }, { status: 201 });
};

export const GET = withErrorHandling(getHandler, 'notifications-get');
export const POST = withErrorHandling(postHandler, 'notifications-post');
