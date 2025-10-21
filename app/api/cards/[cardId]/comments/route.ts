import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { Comment, CommentWithAuthor } from '@/lib/supabase';

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

    // TODO: Create notifications for mentions
    if (mentions && mentions.length > 0) {
      // This will be implemented in the notifications route
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
