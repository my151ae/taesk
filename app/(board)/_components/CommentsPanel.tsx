'use client';

import { useState, useEffect, useRef } from 'react';
import { featureFlags } from '@/lib/featureFlags';
import { supabase, CommentWithAuthor, ProfileSummary } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { RenderCommentBody } from './Mention';

interface CommentsPanelProps {
  cardId: string;
  boardId: string;
}

interface CommentThread extends CommentWithAuthor {
  replies?: CommentWithAuthor[];
}

export default function CommentsPanel({ cardId, boardId }: CommentsPanelProps) {
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [members, setMembers] = useState<ProfileSummary[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (featureFlags.comments) {
      loadComments();
      loadMembers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  // Realtime subscription for comments
  useEffect(() => {
    if (!featureFlags.comments || !cardId) return;

    let channel: RealtimeChannel;

    const setupRealtimeSubscription = async () => {
      // Subscribe to comments changes for this card
      channel = supabase
        .channel(`comments:card_id=${cardId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'comments',
            filter: `card_id=eq.${cardId}`,
          },
          async (payload) => {
            console.log('Comment change detected:', payload);

            if (payload.eventType === 'INSERT') {
              // Fetch the full comment with author info
              const { data: newComment } = await supabase
                .from('comments')
                .select(`
                  *,
                  author:profiles!comments_author_id_fkey(id, full_name, avatar_url, email)
                `)
                .eq('id', payload.new.id)
                .is('deleted_at', null)
                .single();

              if (newComment) {
                setComments((prev) => {
                  // Avoid duplicates
                  if (prev.some((c) => c.id === newComment.id)) return prev;
                  return [...prev, newComment as CommentWithAuthor];
                });
              }
            } else if (payload.eventType === 'UPDATE') {
              const { data: updatedComment } = await supabase
                .from('comments')
                .select(`
                  *,
                  author:profiles!comments_author_id_fkey(id, full_name, avatar_url, email)
                `)
                .eq('id', payload.new.id)
                .single();

              if (updatedComment) {
                setComments((prev) =>
                  prev.map((c) =>
                    c.id === updatedComment.id ? (updatedComment as CommentWithAuthor) : c
                  )
                );
              }
            } else if (payload.eventType === 'DELETE') {
              // Remove deleted comment
              setComments((prev) => prev.filter((c) => c.id !== payload.old.id));
            }
          }
        )
        .subscribe();
    };

    setupRealtimeSubscription();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [cardId]);

  useEffect(() => {
    // Organize comments into threads
    const topLevel = comments.filter((c) => !c.parent_id);
    const threaded: CommentThread[] = topLevel.map((parent) => ({
      ...parent,
      replies: comments.filter((c) => c.parent_id === parent.id),
    }));
    setThreads(threaded);
  }, [comments]);

  const loadComments = async () => {
    try {
      const response = await fetch(`/api/cards/${cardId}/comments`);
      if (response.ok) {
        const { comments: fetchedComments } = await response.json();
        setComments(fetchedComments);
      }
    } catch (error) {
      console.error('Error loading comments:', error);
    }
  };

  const loadMembers = async () => {
    try {
      const response = await fetch(`/api/boards/${boardId}/members`);
      if (response.ok) {
        const { members: fetchedMembers } = await response.json();
        setMembers(fetchedMembers.map((m: any) => m.profile));
      }
    } catch (error) {
      console.error('Error loading members:', error);
    }
  };

  const parseMentions = (text: string): string[] => {
    const mentionRegex = /@(\w+)/g;
    const matches = text.match(mentionRegex) || [];
    return matches
      .map((mention) => {
        const name = mention.slice(1);
        const member = members.find(
          (m) => m.full_name?.toLowerCase().includes(name.toLowerCase())
        );
        return member?.id;
      })
      .filter((id): id is string => !!id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = replyTo && editingId ? editText : newComment;
    if (!text.trim()) return;

    setLoading(true);
    try {
      if (editingId) {
        // Update existing comment
        const response = await fetch(`/api/comments/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: editText }),
        });

        if (response.ok) {
          const { comment } = await response.json();
          setComments(comments.map((c) => (c.id === editingId ? comment : c)));
          setEditingId(null);
          setEditText('');
        }
      } else {
        // Create new comment
        const mentions = parseMentions(text);
        const response = await fetch(`/api/cards/${cardId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: text,
            mentions,
            parent_id: replyTo,
          }),
        });

        if (response.ok) {
          const { comment } = await response.json();
          setComments([...comments, comment]);
          setNewComment('');
          setReplyTo(null);
        }
      }
    } catch (error) {
      console.error('Error posting comment:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm('Delete this comment?')) return;

    try {
      const response = await fetch(`/api/comments/${commentId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setComments(comments.filter((c) => c.id !== commentId));
      }
    } catch (error) {
      console.error('Error deleting comment:', error);
    }
  };

  const handleMentionSelect = (member: ProfileSummary) => {
    const cursorPos = textareaRef.current?.selectionStart || 0;
    const textBefore = newComment.slice(0, cursorPos);
    const textAfter = newComment.slice(cursorPos);
    const lastAtIndex = textBefore.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const newText = textBefore.slice(0, lastAtIndex + 1) + member.full_name + ' ' + textAfter;
      setNewComment(newText);
    }

    setShowMentions(false);
    setMentionSearch('');
  };

  const handleTextChange = (text: string) => {
    setNewComment(text);

    // Check for @ mentions
    const cursorPos = textareaRef.current?.selectionStart || 0;
    const textBefore = text.slice(0, cursorPos);
    const lastAtIndex = textBefore.lastIndexOf('@');

    if (lastAtIndex !== -1 && cursorPos - lastAtIndex < 20) {
      const search = textBefore.slice(lastAtIndex + 1);
      setMentionSearch(search);
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }
  };

  const filteredMembers = mentionSearch
    ? members.filter((m) =>
        m.full_name?.toLowerCase().includes(mentionSearch.toLowerCase())
      )
    : members;

  if (!featureFlags.comments) {
    return null;
  }

  const renderComment = (comment: CommentThread, isReply = false) => (
    <div
      key={comment.id}
      className={`border border-gray-200 dark:border-gray-700 rounded p-3 ${
        isReply ? 'ml-8 mt-2' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0 flex items-center justify-center text-white font-medium">
          {comment.author?.full_name?.[0]?.toUpperCase() || '?'}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">{comment.author?.full_name || 'Unknown'}</div>
            <div className="text-xs text-gray-500">
              {new Date(comment.created_at).toLocaleString()}
            </div>
          </div>

          {editingId === comment.id ? (
            <div className="mt-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleSubmit}
                  className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditingId(null);
                    setEditText('');
                  }}
                  className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                <RenderCommentBody
                  body={comment.body}
                  mentions={comment.mentions || []}
                  profiles={members}
                />
              </div>
              <div className="flex gap-3 mt-2 text-xs text-gray-500">
                <button
                  onClick={() => setReplyTo(comment.id)}
                  className="hover:text-blue-500"
                >
                  Reply
                </button>
                <button
                  onClick={() => {
                    setEditingId(comment.id);
                    setEditText(comment.body);
                  }}
                  className="hover:text-blue-500"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(comment.id)}
                  className="hover:text-red-500"
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-2">
          {comment.replies.map((reply) => renderComment(reply as CommentThread, true))}
        </div>
      )}

      {/* Reply form */}
      {replyTo === comment.id && !editingId && (
        <div className="mt-3 ml-8">
          <textarea
            value={newComment}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="Write a reply..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            ref={textareaRef}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSubmit}
              disabled={loading || !newComment.trim()}
              className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 text-sm"
            >
              Reply
            </button>
            <button
              onClick={() => {
                setReplyTo(null);
                setNewComment('');
              }}
              className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Comments</h3>

      {/* Comment threads */}
      <div className="space-y-3">
        {threads.length === 0 ? (
          <p className="text-sm text-gray-500">No comments yet. Be the first to comment!</p>
        ) : (
          threads.map((thread) => renderComment(thread))
        )}
      </div>

      {/* New comment form (only show if not replying) */}
      {!replyTo && !editingId && (
        <form onSubmit={handleSubmit} className="space-y-2 relative">
          <textarea
            ref={textareaRef}
            value={newComment}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="Write a comment... (Use @ to mention, Shift+Enter for new line, Enter to submit)"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !showMentions) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />

          {/* Mention dropdown */}
          {showMentions && filteredMembers.length > 0 && (
            <div className="absolute bottom-full mb-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg max-h-40 overflow-y-auto z-10">
              {filteredMembers.slice(0, 5).map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => handleMentionSelect(member)}
                  className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                >
                  <div className="w-6 h-6 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white text-xs font-medium">
                    {member.full_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <span className="text-sm">{member.full_name}</span>
                </button>
              ))}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !newComment.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Posting...' : 'Post Comment'}
          </button>
        </form>
      )}
    </div>
  );
}
