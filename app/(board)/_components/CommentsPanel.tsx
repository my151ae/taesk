'use client';

import { useState, useEffect } from 'react';
import { featureFlags } from '@/lib/featureFlags';
import { CommentWithAuthor } from '@/lib/supabase';

interface CommentsPanelProps {
  cardId: string;
}

export default function CommentsPanel({ cardId }: CommentsPanelProps) {
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);

  if (!featureFlags.comments) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/cards/${cardId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newComment }),
      });

      if (response.ok) {
        const { comment } = await response.json();
        setComments([...comments, comment]);
        setNewComment('');
      }
    } catch (error) {
      console.error('Error posting comment:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Comments</h3>

      {/* Comment list */}
      <div className="space-y-3">
        {comments.length === 0 ? (
          <p className="text-sm text-gray-500">No comments yet. Be the first to comment!</p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="border border-gray-200 dark:border-gray-700 rounded p-3">
              <div className="flex items-start gap-2">
                <div className="w-8 h-8 rounded-full bg-gray-300 flex-shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{comment.author?.full_name || 'Unknown'}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{comment.body}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {new Date(comment.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* New comment form */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Write a comment... (Shift+Enter for new line, Enter to submit)"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={3}
          disabled={loading}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <button
          type="submit"
          disabled={loading || !newComment.trim()}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Posting...' : 'Post Comment'}
        </button>
      </form>
    </div>
  );
}
