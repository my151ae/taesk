import type { CommentWithAuthor } from '@/lib/supabase';

export interface CreateCommentParams {
  cardId: string;
  body: string;
  mentions?: string[];
  parentId?: string | null;
  idempotencyKey?: string;
}

export interface UpdateCommentParams {
  commentId: string;
  body: string;
}

export interface FetchCommentsResult {
  comments: CommentWithAuthor[];
  error?: { code: string; message: string };
}

export interface CommentResult {
  comment: CommentWithAuthor;
  error?: { code: string; message: string };
}

/**
 * Fetch all comments for a card
 */
export async function fetchComments(cardId: string): Promise<FetchCommentsResult> {
  try {
    const response = await fetch(`/api/cards/${cardId}/comments`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        comments: [],
        error: errorData.error || { code: 'FETCH_ERROR', message: 'Failed to fetch comments' },
      };
    }

    const data = await response.json();
    return { comments: data.comments || [] };
  } catch (error) {
    console.error('Error fetching comments:', error);
    return {
      comments: [],
      error: { code: 'NETWORK_ERROR', message: 'Network error while fetching comments' },
    };
  }
}

/**
 * Create a new comment
 */
export async function createComment(params: CreateCommentParams): Promise<CommentResult | null> {
  try {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (params.idempotencyKey) {
      headers['Idempotency-Key'] = params.idempotencyKey;
    }

    const response = await fetch(`/api/cards/${params.cardId}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        body: params.body,
        mentions: params.mentions || [],
        parent_id: params.parentId || null,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Create comment failed:', errorData);
      return {
        comment: null as any,
        error: errorData.error || { code: 'CREATE_ERROR', message: 'Failed to create comment' },
      };
    }

    const data = await response.json();
    return { comment: data.comment };
  } catch (error) {
    console.error('Error creating comment:', error);
    return {
      comment: null as any,
      error: { code: 'NETWORK_ERROR', message: 'Network error while creating comment' },
    };
  }
}

/**
 * Update an existing comment
 */
export async function updateComment(params: UpdateCommentParams): Promise<CommentResult | null> {
  try {
    const response = await fetch(`/api/comments/${params.commentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: params.body }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Update comment failed:', errorData);
      return {
        comment: null as any,
        error: errorData.error || { code: 'UPDATE_ERROR', message: 'Failed to update comment' },
      };
    }

    const data = await response.json();
    return { comment: data.comment };
  } catch (error) {
    console.error('Error updating comment:', error);
    return {
      comment: null as any,
      error: { code: 'NETWORK_ERROR', message: 'Network error while updating comment' },
    };
  }
}

/**
 * Delete a comment (soft delete)
 */
export async function deleteComment(commentId: string): Promise<{ success: boolean; error?: { code: string; message: string } }> {
  try {
    const response = await fetch(`/api/comments/${commentId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Delete comment failed:', errorData);
      return {
        success: false,
        error: errorData.error || { code: 'DELETE_ERROR', message: 'Failed to delete comment' },
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Error deleting comment:', error);
    return {
      success: false,
      error: { code: 'NETWORK_ERROR', message: 'Network error while deleting comment' },
    };
  }
}
