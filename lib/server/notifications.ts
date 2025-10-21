import { SupabaseClient } from '@supabase/supabase-js';

export type NotificationType =
  | 'comment_created'
  | 'comment_replied'
  | 'mention'
  | 'assignee_changed'
  | 'due_soon';

export interface CommentNotificationEvent {
  event: 'comment_created' | 'comment_replied' | 'mention';
  commentId: string;
  cardId: string;
  boardId: string;
  senderId: string;
  recipientIds?: string[];
}

interface CreateNotificationParams {
  supabase: SupabaseClient;
  type: NotificationType;
  recipientId: string;
  payload: Record<string, any>;
  dedupeKey?: string;
}

/**
 * Create a notification with deduplication support
 */
export async function createNotification(params: CreateNotificationParams) {
  const { supabase, type, recipientId, payload, dedupeKey } = params;

  // Generate dedupe key if not provided
  const finalDedupeKey =
    dedupeKey ||
    `${type}:${recipientId}:${payload.comment_id || ''}:${payload.card_id || ''}`;

  try {
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
        return { data: null, isDuplicate: true };
      }
      throw error;
    }

    return { data, isDuplicate: false };
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
  payload: Record<string, any>
): string {
  switch (type) {
    case 'comment_created':
      return `New comment on card: ${payload.card_title || 'Untitled'}`;
    case 'comment_replied':
      return `${payload.sender_name || 'Someone'} replied to your comment`;
    case 'mention':
      return `${payload.sender_name || 'Someone'} mentioned you in a comment`;
    case 'assignee_changed':
      return `You were assigned to card: ${payload.card_title || 'Untitled'}`;
    case 'due_soon':
      return `Card due soon: ${payload.card_title || 'Untitled'}`;
    default:
      return 'New notification';
  }
}

/**
 * Create notifications for a comment event
 */
export async function createCommentNotifications(
  supabase: SupabaseClient,
  event: CommentNotificationEvent,
  senderName?: string
) {
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

    const notifications = await Promise.all(
      recipients.map(async (recipientId) => {
        const payload = {
          comment_id: event.commentId,
          card_id: event.cardId,
          board_id: event.boardId,
          sender_id: event.senderId,
          sender_name: senderName || 'Unknown',
          card_title: card?.title || 'Untitled',
          message: generateNotificationMessage(event.event, {
            sender_name: senderName,
            card_title: card?.title,
          }),
        };

        return await createNotification({
          supabase,
          type: event.event,
          recipientId,
          payload,
        });
      })
    );

    const created = notifications.filter((n) => !n.isDuplicate).length;
    const duplicates = notifications.filter((n) => n.isDuplicate).length;

    console.log(
      `Created ${created} notifications (${duplicates} duplicates skipped) for ${event.event}`
    );

    return { created, duplicates };
  } catch (error) {
    console.error('Error creating comment notifications:', error);
    throw error;
  }
}
