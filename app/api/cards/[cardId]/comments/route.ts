import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { Comment, CommentWithAuthor } from '@/lib/supabase';
import { createCommentNotifications } from '@/lib/server/notifications';

// GET /api/cards/[cardId]/comments - List comments for a card
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const supabase = await createServerSupabaseClient();
  const { cardId } = await params;

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401 }
      );
    }

    // Fetch comments with author info
    const { data: comments, error } = await supabase
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
      .eq('card_id', cardId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching comments:', error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    // Transform data
    const transformedComments: CommentWithAuthor[] = (comments || []).map((comment: any) => ({
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
  } catch (error) {
    console.error('Unexpected error in GET /api/cards/[cardId]/comments:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

// POST /api/cards/[cardId]/comments - Create a comment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const supabase = await createServerSupabaseClient();
  const { cardId } = await params;

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401 }
      );
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

    // Validate mentions - ensure all are valid UUIDs and board members
    if (mentions && mentions.length > 0) {
      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const invalidUUIDs = mentions.filter((id) => !uuidRegex.test(id));

      if (invalidUUIDs.length > 0) {
        return NextResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid mention UUID format',
            },
            issues: invalidUUIDs.map((id) => ({
              field: 'mentions',
              message: `Invalid UUID: ${id}`,
            })),
          },
          { status: 400 }
        );
      }

      // Get the board_id for this card
      const { data: card, error: cardError } = await supabase
        .from('cards')
        .select('board_id')
        .eq('id', cardId)
        .single();

      if (cardError || !card) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Card not found' } },
          { status: 404 }
        );
      }

      // Check if all mentioned users are board members
      const { data: boardMembers, error: membersError } = await supabase
        .from('board_members')
        .select('profile_id')
        .eq('board_id', card.board_id);

      if (membersError) {
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: 'Failed to validate mentions' } },
          { status: 500 }
        );
      }

      const memberIds = new Set(boardMembers?.map((m) => m.profile_id) || []);
      const invalidMentions = mentions.filter((id) => !memberIds.has(id));

      if (invalidMentions.length > 0) {
        return NextResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Some mentioned users are not board members',
            },
            issues: invalidMentions.map((id) => ({
              field: 'mentions',
              message: `User ${id} is not a board member`,
            })),
          },
          { status: 400 }
        );
      }
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
          full_name,
          avatar_url,
          email
        )
      `)
      .single();

    if (error) {
      console.error('Error creating comment:', error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    // Get card's board_id for notifications
    const { data: cardData } = await supabase
      .from('cards')
      .select('board_id')
      .eq('id', cardId)
      .single();

    // Get sender name
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', user.id)
      .single();

    const senderName = senderProfile?.full_name || senderProfile?.email || 'Unknown';

    // Create notifications
    if (cardData) {
      try {
        // Mention notifications
        if (mentions && mentions.length > 0) {
          await createCommentNotifications(
            supabase,
            {
              event: 'mention',
              commentId: newComment.id,
              cardId,
              boardId: cardData.board_id,
              senderId: user.id,
              recipientIds: mentions,
            },
            senderName
          );
        }

        // Comment notification (for card participants)
        await createCommentNotifications(
          supabase,
          {
            event: parent_id ? 'comment_replied' : 'comment_created',
            commentId: newComment.id,
            cardId,
            boardId: cardData.board_id,
            senderId: user.id,
          },
          senderName
        );
      } catch (notifError) {
        // Log but don't fail the comment creation
        console.error('Error creating notifications:', notifError);
      }
    }

    return NextResponse.json({ comment: newComment }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/cards/[cardId]/comments:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
