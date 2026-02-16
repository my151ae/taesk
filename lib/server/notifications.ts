import 'server-only';

import { SupabaseClient } from '@supabase/supabase-js';

import type { QuietHoursPreference } from '@/lib/supabase';
import { createServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin';

export type NotificationType =
  | 'comment_created'
  | 'comment_replied'
  | 'mention'
  | 'assignee_changed'
  | 'due_soon'
  | 'test';

export interface CommentNotificationEvent {
  event: 'comment_created' | 'comment_replied' | 'mention';
  commentId: string;
  cardId: string;
  boardId: string;
  senderId: string;
  recipientIds?: string[];
  commentBody?: string | null;
  cardShortId?: string | null;
  cardSlug?: string | null;
}

interface CreateNotificationParams {
  type: NotificationType;
  recipientId: string;
  payload: Record<string, unknown>;
  dedupeKey?: string;
}

interface CreateNotificationResult {
  data: unknown;
  isDuplicate: boolean;
  skipped: boolean;
}

export function isWithinQuietHours(
  quietHours: QuietHoursPreference,
  referenceDate: Date = new Date()
): boolean {
  try {
    if (!quietHours.start || !quietHours.end || !quietHours.timezone) {
      return false;
    }

    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: quietHours.timezone,
    });

    const userTime = formatter.format(referenceDate);
    const [hours, minutes] = userTime.split(':').map(Number);
    const currentMinutes = hours * 60 + minutes;

    const [startHours, startMinutes] = quietHours.start.split(':').map(Number);
    const [endHours, endMinutes] = quietHours.end.split(':').map(Number);
    const startTotal = startHours * 60 + startMinutes;
    const endTotal = endHours * 60 + endMinutes;

    if (Number.isNaN(startTotal) || Number.isNaN(endTotal)) {
      return false;
    }

    if (startTotal > endTotal) {
      // Overnight quiet hours (e.g., 22:00 - 07:00)
      return currentMinutes >= startTotal || currentMinutes < endTotal;
    }

    return currentMinutes >= startTotal && currentMinutes < endTotal;
  } catch (error) {
    console.error('Error evaluating quiet hours:', error);
    return false;
  }
}

/**
 * Create a notification with deduplication support
 */
export async function createNotification(
  params: CreateNotificationParams
): Promise<CreateNotificationResult> {
  const { type, recipientId, payload, dedupeKey } = params;
  const supabase = createServiceRoleSupabaseClient();

  // Generate dedupe key if not provided
  const finalDedupeKey =
    dedupeKey ||
    `${type}:${recipientId}:${payload.comment_id || ''}:${payload.card_id || ''}`;

  try {
    const { data: prefs, error: prefsError } = await supabase
      .from('notification_preferences')
      .select('in_app_enabled, quiet_hours')
      .eq('profile_id', recipientId)
      .maybeSingle();

    if (prefsError) {
      console.error('Error fetching notification preferences:', prefsError);
    }

    if (prefs && prefs.in_app_enabled === false) {
      console.log(`In-app notifications disabled for ${recipientId}, skipping`);
      return { data: null, isDuplicate: false, skipped: true };
    }

    if (prefs?.quiet_hours && isWithinQuietHours(prefs.quiet_hours)) {
      console.log(`User ${recipientId} is within quiet hours, skipping notification`);
      return { data: null, isDuplicate: false, skipped: true };
    }

    const { data, error } = await supabase
      .from('notifications')
      .insert({
        recipient_id: recipientId,
        type,
        payload,
        dedupe_key: finalDedupeKey,
      })
      .select()
      .single();

    if (error) {
      // Check if it's a unique constraint violation (duplicate dedupe_key)
      if (error.code === '23505') {
        console.log(`Notification with dedupe_key "${finalDedupeKey}" already exists, skipping`);
        return { data: null, isDuplicate: true, skipped: false };
      }
      throw error;
    }

    return { data, isDuplicate: false, skipped: false };
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
}

/**
 * Resolve recipients for a comment notification
 * Returns unique user IDs excluding the sender
 */
export async function resolveCommentRecipients(
  supabase: SupabaseClient,
  event: CommentNotificationEvent
): Promise<string[]> {
  const { commentId, cardId, senderId, recipientIds, event: eventType } = event;

  const recipients = new Set<string>();

  // For mentions, use provided recipient IDs
  if (eventType === 'mention' && recipientIds) {
    recipientIds.forEach((id) => recipients.add(id));
  } else {
    // Get card info including creator (user_id) and assignee
    const { data: card } = await supabase
      .from('cards')
      .select('user_id, assignee_id, board_id')
      .eq('id', cardId)
      .single();

    if (card) {
      // Add card creator
      if (card.user_id) {
        recipients.add(card.user_id);
      }

      // Add assignee
      if (card.assignee_id) {
        recipients.add(card.assignee_id);
      }

      // Get all previous commenters on this card
      const { data: previousComments } = await supabase
        .from('comments')
        .select('author_id')
        .eq('card_id', cardId)
        .is('deleted_at', null);

      if (previousComments) {
        previousComments.forEach((c) => recipients.add(c.author_id));
      }
    }
  }

  // Exclude sender from recipients
  recipients.delete(senderId);

  return Array.from(recipients);
}

/**
 * Generate notification message based on type and payload
 */
export function generateNotificationMessage(
  type: NotificationType,
  payload: Record<string, unknown>
): string {
  const asString = (value: unknown, fallback: string) =>
    typeof value === 'string' && value.trim().length > 0 ? value : fallback;

  switch (type) {
    case 'comment_created':
      return `New comment on card: ${asString(payload.card_title, 'Untitled')}`;
    case 'comment_replied':
      return `${asString(payload.sender_name, 'Someone')} replied to your comment`;
    case 'mention':
      return `${asString(payload.sender_name, 'Someone')} mentioned you in a comment`;
    case 'assignee_changed':
      return `You were assigned to card: ${asString(payload.card_title, 'Untitled')}`;
    case 'due_soon':
      return `Card due soon: ${asString(payload.card_title, 'Untitled')}`;
    case 'test':
      return asString(payload.message, 'Test notification');
    default:
      return 'New notification';
  }
}

function buildCommentSnippet(commentBody?: string | null): string | null {
  if (!commentBody) {
    return null;
  }
  const normalized = commentBody.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }
  const limit = 140;
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit).trim()}…`;
}

/**
 * Create notifications for a comment event
 */
export async function createCommentNotifications(
  event: CommentNotificationEvent,
  senderName?: string
) {
  const supabase = createServiceRoleSupabaseClient();

  try {
    const recipients = await resolveCommentRecipients(supabase, event);

    if (recipients.length === 0) {
      console.log('No recipients for comment notification');
      return { created: 0, duplicates: 0 };
    }

    // Fetch card info for the message
    const { data: card } = await supabase
      .from('cards')
      .select('title')
      .eq('id', event.cardId)
      .single();

    const snippet = buildCommentSnippet(event.commentBody);
    const messageBase = generateNotificationMessage(event.event, {
      sender_name: senderName,
      card_title: card?.title,
    });
    const message = snippet ? `${messageBase}: ${snippet}` : messageBase;

    const notifications = await Promise.all(
      recipients.map(async (recipientId) => {
        const payload = {
          comment_id: event.commentId,
          card_id: event.cardId,
          card_short_id: event.cardShortId ?? null,
          card_slug: event.cardSlug ?? null,
          board_id: event.boardId,
          sender_id: event.senderId,
          sender_name: senderName || 'Unknown',
          card_title: card?.title || 'Untitled',
          comment_body: event.commentBody ?? null,
          message,
        };

        return await createNotification({
          type: event.event,
          recipientId,
          payload,
        });
      })
    );

    const created = notifications.filter((n) => !n.isDuplicate && !n.skipped).length;
    const duplicates = notifications.filter((n) => n.isDuplicate).length;
    const skipped = notifications.filter((n) => n.skipped).length;

    console.log(
      `Created ${created} notifications (${duplicates} duplicates skipped, ${skipped} suppressed) for ${event.event}`
    );

    return { created, duplicates, skipped };
  } catch (error) {
    console.error('Error creating comment notifications:', error);
    throw error;
  }
}
