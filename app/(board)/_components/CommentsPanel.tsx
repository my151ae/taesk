'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { featureFlags } from '@/lib/featureFlags';
import type { ProfileSummary, MemberRole } from '@/lib/supabase';
import { RenderCommentBody } from './Mention';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  BoardComment,
  initializeCommentsStore,
  useCommentsStore,
} from '../_stores/comments-store';

interface CommentsPanelProps {
  cardId: string;
  boardId: string;
}

interface CommentThread extends BoardComment {
  replies?: BoardComment[];
}

const buildThreads = (comments: BoardComment[]): CommentThread[] => {
  const topLevel = comments.filter(comment => !comment.parent_id);
  return topLevel.map(parent => ({
    ...parent,
    replies: comments.filter(comment => comment.parent_id === parent.id),
  }));
};

const EMPTY_COMMENTS: BoardComment[] = [];

/**
 * Parse UUID mention tokens (<@uuid>) from comment body
 * Returns array of unique UUIDs
 */
const parseMentions = (text: string): string[] => {
  const mentionRegex = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;
  const matches = text.match(mentionRegex) || [];

  const uuids = matches
    .map(match => {
      const uuidMatch = match.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      return uuidMatch ? uuidMatch[0] : null;
    })
    .filter((uuid): uuid is string => Boolean(uuid));

  // Return unique UUIDs
  return Array.from(new Set(uuids));
};

export default function CommentsPanel({ cardId, boardId }: CommentsPanelProps) {
  const { user } = useAuth();
  const [members, setMembers] = useState<ProfileSummary[]>([]);
  const [userRole, setUserRole] = useState<MemberRole | null>(null);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [mentionSearch, setMentionSearch] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadComments = useCommentsStore(state => state.loadComments);
  const submitComment = useCommentsStore(state => state.submitComment);
  const submitEdit = useCommentsStore(state => state.submitEdit);
  const submitDelete = useCommentsStore(state => state.submitDelete);
  const retryPending = useCommentsStore(state => state.retryPending);

  const commentsState = useCommentsStore(state => state.cards[cardId]);
  const comments = commentsState?.comments ?? EMPTY_COMMENTS;
  const commentStatus = commentsState?.status ?? 'idle';
  const commentError = commentsState?.error;

  const filteredMembers = mentionSearch
    ? members.filter(member =>
        member.full_name?.toLowerCase().includes(mentionSearch.toLowerCase()) ||
        member.email?.toLowerCase().includes(mentionSearch.toLowerCase()),
      )
    : members;

  const threads = useMemo(() => buildThreads(comments), [comments]);

  const currentProfile = useMemo(
    () => members.find(member => member.id === user?.id) ?? null,
    [members, user?.id],
  );

  useEffect(() => {
    initializeCommentsStore();
  }, []);

  useEffect(() => {
    retryPending().catch(error => {
      console.warn('Failed to retry pending comments on mount', error);
    });
  }, [retryPending]);

  useEffect(() => {
    if (!featureFlags.comments) return;
    loadComments(cardId);
  }, [cardId, loadComments]);

  useEffect(() => {
    setReplyTo(null);
    setEditingId(null);
    setNewComment('');
    setEditText('');
    setFormError(null);
    setBannerMessage(null);
  }, [cardId]);

  useEffect(() => {
    if (!featureFlags.comments) return;

    let ignore = false;

    const loadMembers = async () => {
      try {
        const response = await fetch(`/api/boards/${boardId}/members`);
        if (!response.ok) return;
        const { members: fetchedMembers } = await response.json();
        if (!ignore) {
          setMembers(fetchedMembers.map((member: { profile: ProfileSummary }) => member.profile));

          // Set current user's role
          if (user?.id) {
            const currentMember = fetchedMembers.find(
              (m: { profile_id: string; role: MemberRole }) => m.profile_id === user.id
            );
            if (currentMember) {
              setUserRole(currentMember.role);
            }
          }
        }
      } catch (error) {
        console.error('Error loading members:', error);
      }
    };

    loadMembers();

    return () => {
      ignore = true;
    };
  }, [boardId, user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleFocusMentions = () => {
      if (!isSubmitting) {
        retryPending().catch(error => {
          console.warn('Failed to retry pending comments', error);
        });
      }
    };

    window.addEventListener('focus', handleFocusMentions);
    return () => window.removeEventListener('focus', handleFocusMentions);
  }, [isSubmitting, retryPending]);

  const handleMentionSelect = (member: ProfileSummary) => {
    const cursorPos = textareaRef.current?.selectionStart ?? 0;
    const textBefore = newComment.slice(0, cursorPos);
    const textAfter = newComment.slice(cursorPos);
    const lastAtIndex = textBefore.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      // Insert UUID token directly: <@uuid>
      const displayName = member.full_name || member.email || 'Unknown';
      const mentionToken = `<@${member.id}>`;
      const newText = `${textBefore.slice(0, lastAtIndex)}@${displayName}${mentionToken} ${textAfter}`;
      setNewComment(newText);

      // Move cursor after the mention
      setTimeout(() => {
        if (textareaRef.current) {
          const newPos = lastAtIndex + displayName.length + mentionToken.length + 2;
          textareaRef.current.setSelectionRange(newPos, newPos);
          textareaRef.current.focus();
        }
      }, 0);
    }

    setShowMentions(false);
    setMentionSearch('');
  };

  const handleTextChange = (text: string) => {
    setNewComment(text);

    const cursorPos = textareaRef.current?.selectionStart ?? 0;
    const textBefore = text.slice(0, cursorPos);
    const lastAtIndex = textBefore.lastIndexOf('@');

    if (lastAtIndex !== -1 && cursorPos - lastAtIndex < 24) {
      const search = textBefore.slice(lastAtIndex + 1);
      setMentionSearch(search);
      setShowMentions(true);
      setSelectedMentionIndex(0);
    } else {
      setShowMentions(false);
      setSelectedMentionIndex(0);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = editingId ? editText : newComment;
    if (!text.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setFormError(null);
    setBannerMessage(null);

    try {
      if (editingId) {
        const result = await submitEdit({ commentId: editingId, body: editText, cardId });
        if (!result.success) {
          setFormError(result.message ?? 'コメントの更新に失敗しました');
        } else {
          setEditingId(null);
          setEditText('');
        }
      } else {
        const mentions = parseMentions(text);
        const result = await submitComment({
          cardId,
          body: text,
          mentions,
          parentId: replyTo,
          authorProfile: currentProfile,
          authorId: user?.id ?? null,
        });

        if (!result.success) {
          setFormError(result.message ?? 'コメントの投稿に失敗しました');
        } else {
          setNewComment('');
          setReplyTo(null);
          if (result.message) {
            setBannerMessage(result.message);
          }
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm('このコメントを削除しますか？')) return;
    const result = await submitDelete(cardId, commentId);
    if (!result.success) {
      setFormError(result.message ?? 'コメントの削除に失敗しました');
    }
  };

  if (!featureFlags.comments) {
    return null;
  }

  const renderComment = (comment: CommentThread, isReply = false) => {
    const isAuthor = comment.author_id === user?.id;
    const hasError = Boolean(comment.errorMessage);

    return (
      <div
        key={comment.id}
        className={`border border-gray-200 dark:border-gray-700 rounded p-3 ${isReply ? 'ml-8 mt-2' : ''} ${comment.optimistic ? 'opacity-70' : ''}`}
      >
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0 flex items-center justify-center text-white font-medium">
            {comment.author?.full_name?.[0]?.toUpperCase() || comment.author?.email?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">
                {comment.author?.full_name || comment.author?.email || 'Unknown'}
              </div>
              <div className="text-xs text-gray-500">
                {new Date(comment.created_at).toLocaleString()}
              </div>
              {comment.optimistic && (
                <span className="text-xs text-sky-600 dark:text-sky-400">送信待ち...</span>
              )}
            </div>

            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              <RenderCommentBody
                body={comment.body}
                mentions={comment.mentions || []}
                profiles={members}
              />
            </div>

            {hasError && (
              <div className="mt-2 text-xs text-red-500">
                {comment.errorMessage}
              </div>
            )}

            <div className="flex gap-3 mt-2 text-xs text-gray-500">
              {userRole !== 'viewer' && (
                <button onClick={() => setReplyTo(comment.id)} className="hover:text-blue-500">
                  返信
                </button>
              )}
              {isAuthor && !comment.optimistic && (
                <>
                  <button
                    onClick={() => {
                      setEditingId(comment.id);
                      setEditText(comment.body);
                    }}
                    className="hover:text-blue-500"
                  >
                    編集
                  </button>
                  <button onClick={() => handleDelete(comment.id)} className="hover:text-red-500">
                    削除
                  </button>
                </>
              )}
            </div>

            {editingId === comment.id && (
              <div className="mt-3">
                <textarea
                  value={editText}
                  onChange={event => setEditText(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting || !editText.trim()}
                    className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setEditText('');
                    }}
                    className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {comment.replies && comment.replies.length > 0 && (
          <div className="mt-2">
            {comment.replies.map(reply => renderComment(reply as CommentThread, true))}
          </div>
        )}

        {replyTo === comment.id && !editingId && (
          <div className="mt-3 ml-8">
            <textarea
              value={newComment}
              onChange={event => handleTextChange(event.target.value)}
              placeholder="返信を書く..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              ref={textareaRef}
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !newComment.trim()}
                className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 text-sm"
              >
                返信
              </button>
              <button
                onClick={() => {
                  setReplyTo(null);
                  setNewComment('');
                }}
                className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">コメント</h3>
        {commentStatus === 'loading' && <span className="text-xs text-gray-500">読み込み中...</span>}
      </div>

      {bannerMessage && (
        <div className="rounded bg-sky-50 text-sky-700 px-3 py-2 text-sm dark:bg-sky-900/30 dark:text-sky-200">
          {bannerMessage}
        </div>
      )}

      {commentError && (
        <div className="rounded bg-red-50 text-red-600 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-200 flex items-center justify-between">
          <span>{commentError}</span>
          <button
            onClick={() => loadComments(cardId, true)}
            className="text-xs underline hover:opacity-80"
          >
            再読み込み
          </button>
        </div>
      )}

      <div className="space-y-3">
        {threads.length === 0 && commentStatus === 'ready' && (
          <p className="text-sm text-gray-500">まだコメントがありません。最初のコメントを残しましょう。</p>
        )}

        {threads.map(thread => renderComment(thread))}
      </div>

      {/* New comment form */}
      {!editingId && userRole !== 'viewer' && (
        <form onSubmit={handleSubmit} className="space-y-2 relative">
          {formError && (
            <div className="text-sm text-red-500">{formError}</div>
          )}
          <textarea
            ref={textareaRef}
            value={newComment}
            onChange={event => handleTextChange(event.target.value)}
            placeholder="コメントを書く...（@でメンション、Shift+Enterで改行）"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
            disabled={isSubmitting}
            onKeyDown={event => {
              if (showMentions && filteredMembers.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSelectedMentionIndex(prev =>
                    prev < Math.min(filteredMembers.length, 6) - 1 ? prev + 1 : prev
                  );
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSelectedMentionIndex(prev => (prev > 0 ? prev - 1 : 0));
                } else if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleMentionSelect(filteredMembers[selectedMentionIndex]);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setShowMentions(false);
                  setSelectedMentionIndex(0);
                }
              } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSubmit(event);
              }
            }}
          />

          {showMentions && filteredMembers.length > 0 && (
            <div
              role="listbox"
              className="absolute bottom-full mb-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg max-h-40 overflow-y-auto z-10"
            >
              {filteredMembers.slice(0, 6).map((member, index) => (
                <button
                  key={member.id}
                  type="button"
                  role="option"
                  aria-selected={index === selectedMentionIndex}
                  onClick={() => handleMentionSelect(member)}
                  className={`w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 ${
                    index === selectedMentionIndex
                      ? 'bg-blue-100 dark:bg-blue-900/30'
                      : ''
                  }`}
                >
                  <div className="w-6 h-6 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white text-xs font-medium">
                    {member.full_name?.[0]?.toUpperCase() || member.email?.[0]?.toUpperCase() || '?'}
                  </div>
                  <span className="text-sm">
                    {member.full_name || member.email || 'Unknown user'}
                  </span>
                </button>
              ))}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !newComment.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? '送信中...' : 'コメントを投稿'}
          </button>
        </form>
      )}

      {/* Read-only message for viewers */}
      {!editingId && userRole === 'viewer' && (
        <div className="rounded bg-gray-100 dark:bg-gray-800 px-4 py-3 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
          閲覧専用の権限のため、コメントを投稿できません。
        </div>
      )}
    </div>
  );
}
