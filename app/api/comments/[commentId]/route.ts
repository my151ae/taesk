import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

// PATCH /api/comments/[commentId] - Update a comment
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const supabase = await createServerSupabaseClient();
  const { commentId } = await params;

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { body: commentBody } = body as { body: string };

    if (!commentBody || !commentBody.trim()) {
      return NextResponse.json({ error: 'Comment body is required' }, { status: 400 });
    }

    // Update comment
    const { data: updatedComment, error } = await supabase
      .from('comments')
      .update({
        body: commentBody,
        updated_at: new Date().toISOString(),
      })
      .eq('id', commentId)
      .eq('author_id', user.id) // Ensure user owns the comment
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
      console.error('Error updating comment:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ comment: updatedComment });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/comments/[commentId]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/comments/[commentId] - Soft delete a comment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const supabase = await createServerSupabaseClient();
  const { commentId } = await params;

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Soft delete by setting deleted_at
    const { data: deletedComment, error } = await supabase
      .from('comments')
      .update({
        deleted_at: new Date().toISOString(),
      })
      .eq('id', commentId)
      .eq('author_id', user.id) // Ensure user owns the comment
      .select()
      .single();

    if (error) {
      console.error('Error deleting comment:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error in DELETE /api/comments/[commentId]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
