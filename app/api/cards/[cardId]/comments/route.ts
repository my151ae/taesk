import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { CommentWithAuthor } from '@/lib/supabase';
import { withErrorHandling } from '@/lib/server/with-error-handling';
import {
  accessErrorResponse,
  assertCardMemberAccess,
  parseCreateCommentBody,
  resolveNotificationBody,
  resolveReplyAuthorId,
  resolveSenderName,
  validateMentionsForBoard,
} from '@/lib/server/comments-service';
import { notifyCommentCreated } from '@/lib/server/comments-notifications';
import { requireAuthenticatedUser } from '@/lib/server/api-security';

// GET /api/cards/[cardId]/comments - List comments for a card
const getHandler = async (
  _request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) => {
  const supabase = await createServerSupabaseClient();
  const { cardId } = await params;

  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json(
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

  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json(
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

  const parsedBody = parseCreateCommentBody(await request.json());
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const { body: commentBody, mentions, parentId } = parsedBody.data;

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
      parent_id: parentId,
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
  const replyToAuthorId = await resolveReplyAuthorId(supabase, parentId, cardId);

  if (cardMeta) {
    try {
      await notifyCommentCreated({
        cardId,
        boardId,
        commentId: newComment.id,
        senderId: user.id,
        senderName,
        mentions,
        parentId,
        replyToAuthorId,
        notificationBody,
        cardMeta,
      });
    } catch (_notifError) {
      // Log but don't fail the comment creation
      console.error('[comments:post] notification creation failed');
    }
  }

  return NextResponse.json({ comment: newComment }, { status: 201 });
};

export const GET = withErrorHandling(getHandler, 'comments-get');
export const POST = withErrorHandling(postHandler, 'comments-post');
