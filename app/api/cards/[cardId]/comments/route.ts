import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { CommentWithAuthor } from '@/lib/supabase';
import {
  createCommentNotifications,
  createNotification,
  generateNotificationMessage,
} from '@/lib/server/notifications';
import { withErrorHandling } from '@/lib/server/with-error-handling';
import {
  accessErrorResponse,
  assertCardMemberAccess,
  resolveNotificationBody,
  resolveReplyAuthorId,
  resolveSenderName,
  validateMentionsForBoard,
} from '@/lib/server/comments-service';

// GET /api/cards/[cardId]/comments - List comments for a card
const getHandler = async (
  _request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) => {
  const supabase = await createServerSupabaseClient();
  const { cardId } = await params;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
      { status: 401 }
    );
  }

  try {
    await assertCardMemberAccess(supabase, cardId, user.id);
  } catch (accessError) {
    const reason = accessError instanceof Error ? accessError.message : 'UNKNOWN';
    return accessErrorResponse(reason, 'comments:get');
  }

  // Fetch comments with author info (using profiles!inner for better performance)
  const { data: comments, error } = await supabase
    .from('comments')
    .select(`
      *,
      author:profiles!author_id (
        id,
        username,
        display_name,
        full_name,
        avatar_url,
        email
      )
    `)
    .eq('card_id', cardId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[comments:get] fetch failed');
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  // Transform data
  const transformedComments: CommentWithAuthor[] = (comments || []).map((comment: CommentWithAuthor) => ({
    id: comment.id,
    card_id: comment.card_id,
    author_id: comment.author_id,
    parent_id: comment.parent_id,
    body: comment.body,
    mentions: comment.mentions,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
    deleted_at: comment.deleted_at,
    author: comment.author,
  }));

  return NextResponse.json({ comments: transformedComments });
};

// POST /api/cards/[cardId]/comments - Create a comment
const postHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) => {
  const supabase = await createServerSupabaseClient();
  const { cardId } = await params;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
      { status: 401 }
    );
  }

  let boardId: string;
  let cardMeta: { title: string | null; short_id: string | null; slug: string | null } | null = null;
  try {
    const access = await assertCardMemberAccess(supabase, cardId, user.id);
    boardId = access.boardId;
    cardMeta = access.cardMeta;
  } catch (accessError) {
    const reason = accessError instanceof Error ? accessError.message : 'UNKNOWN';
    return accessErrorResponse(reason, 'comments:post');
  }

  // Check Idempotency-Key header for duplicate prevention
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (idempotencyKey) {
    // Check if a comment with this key already exists
    const { data: existingComment, error: checkError } = await supabase
      .from('comments')
      .select(`
        *,
        author:author_id (
          id,
          full_name,
          avatar_url,
          email
        )
      `)
      .eq('idempotency_key', idempotencyKey)
      .is('deleted_at', null)
      .maybeSingle();

    if (!checkError && existingComment) {
      // Return existing comment (idempotent response)
      return NextResponse.json({ comment: existingComment }, { status: 200 });
    }
  }

  const body = await request.json();
  const { body: commentBody, mentions = [], parent_id = null } = body as {
    body: string;
    mentions?: string[];
    parent_id?: string | null;
  };

  if (!commentBody || !commentBody.trim()) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Comment body is required' } },
      { status: 400 }
    );
  }

  const mentionValidation = await validateMentionsForBoard(supabase, boardId, mentions);
  if (!mentionValidation.ok) {
    return mentionValidation.response;
  }

  // Insert comment
  const { data: newComment, error } = await supabase
    .from('comments')
    .insert({
      card_id: cardId,
      author_id: user.id,
      parent_id,
      body: commentBody,
      mentions,
      idempotency_key: idempotencyKey || null,
    })
    .select(`
      *,
      author:author_id (
        id,
        username,
        display_name,
        full_name,
        avatar_url,
        email
      )
    `)
    .single();

  if (error) {
    console.error('[comments:post] create failed');
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  const senderName = await resolveSenderName(supabase, user.id);
  const notificationBody = await resolveNotificationBody(supabase, commentBody, mentions);
  const replyToAuthorId = await resolveReplyAuthorId(supabase, parent_id, cardId);

  // Create notifications
  if (cardMeta) {
    try {
      const mentionRecipients =
        parent_id && replyToAuthorId
          ? mentions.filter((id) => id !== replyToAuthorId)
          : mentions;

      // Mention notifications (new comments + replies)
      if (mentionRecipients && mentionRecipients.length > 0) {
        await createCommentNotifications(
          {
            event: 'mention',
            commentId: newComment.id,
            cardId,
            boardId: boardId,
            senderId: user.id,
            recipientIds: mentionRecipients,
            commentBody: notificationBody,
            cardShortId: cardMeta.short_id,
            cardSlug: cardMeta.slug,
          },
          senderName
        );
      }

      // Reply notification (reply target only)
      if (parent_id && replyToAuthorId && replyToAuthorId !== user.id) {
        const snippet = notificationBody.replace(/\s+/g, ' ').trim();
        const preview =
          snippet.length > 140 ? `${snippet.slice(0, 140).trim()}…` : snippet;
        const payload = {
          comment_id: newComment.id,
          card_id: cardId,
          card_short_id: cardMeta.short_id ?? null,
          card_slug: cardMeta.slug ?? null,
          board_id: boardId,
          sender_id: user.id,
          sender_name: senderName,
          card_title: cardMeta.title || 'Untitled',
          comment_body: notificationBody,
          message: preview
            ? `${generateNotificationMessage('comment_replied', {
                sender_name: senderName,
                card_title: cardMeta.title,
              })}: ${preview}`
            : generateNotificationMessage('comment_replied', {
                sender_name: senderName,
                card_title: cardMeta.title,
              }),
        };

        await createNotification({
          type: 'comment_replied',
          recipientId: replyToAuthorId,
          payload,
        });
      }
    } catch (_notifError) {
      // Log but don't fail the comment creation
      console.error('[comments:post] notification creation failed');
    }
  }

  return NextResponse.json({ comment: newComment }, { status: 201 });
};

export const GET = withErrorHandling(getHandler, 'comments-get');
export const POST = withErrorHandling(postHandler, 'comments-post');
