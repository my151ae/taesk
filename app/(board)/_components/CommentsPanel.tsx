'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { featureFlags } from '@/lib/featureFlags';
import { supabase, type ProfileSummary, type MemberRole } from '@/lib/supabase';
import { resolveProfileIdentity, getProfileInitial } from '@/lib/usernames';
import { RenderCommentBody } from './Mention';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  BoardComment,
  initializeCommentsStore,
  useCommentsStore,
} from '../_stores/comments-store';
import { useBoardMembersStore } from '../_stores/board-members-store';
import CommentEditor from './tiptap/CommentEditor';

interface CommentsPanelProps {
  cardId: string;
  boardId: string;
  initialProfiles?: ProfileSummary[]; // Pre-loaded profiles from parent to avoid re-fetch
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

export default function CommentsPanel({ cardId, boardId, initialProfiles }: CommentsPanelProps) {
  const { user } = useAuth();
  const { getMembers: getStoredMembers } = useBoardMembersStore();

  // Try to get from store first, fallback to initialProfiles
  const storedMembers = getStoredMembers(boardId);
  const [members, setMembers] = useState<ProfileSummary[]>(
    storedMembers?.map(m => m.profile) ?? initialProfiles ?? []
  );
  const [userRole, setUserRole] = useState<MemberRole | null>(null);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Performance measurement
  useEffect(() => {
    if (typeof performance !== 'undefined') {
      performance.mark('cmt-modal-open');
    }
  }, []);

  const loadComments = useCommentsStore(state => state.loadComments);
  const submitComment = useCommentsStore(state => state.submitComment);
  const submitEdit = useCommentsStore(state => state.submitEdit);
  const submitDelete = useCommentsStore(state => state.submitDelete);
  const retryPending = useCommentsStore(state => state.retryPending);

  const commentsState = useCommentsStore(state => state.cards[cardId]);
  const comments = commentsState?.comments ?? EMPTY_COMMENTS;
  const commentStatus = commentsState?.status ?? 'idle';
  const commentError = commentsState?.error;

  const threads = useMemo(() => buildThreads(comments), [comments]);

  const currentProfile = useMemo(
    () => members.find(member => member.id === user?.id) ?? null,
    [members, user?.id],
  );

  // Performance: first comment render
  useEffect(() => {
    if (comments.length > 0 && typeof performance !== 'undefined') {
      performance.mark('cmt-first-render');
      performance.measure('cmt_TTI', 'cmt-modal-open', 'cmt-first-render');
    }
  }, [comments]);

  // Performance: all comments loaded
  useEffect(() => {
    if (commentStatus === 'ready' && typeof performance !== 'undefined') {
      performance.mark('cmt-all-rendered');
      performance.measure('cmt_TTC', 'cmt-modal-open', 'cmt-all-rendered');

      // Log performance metrics
      try {
        const tti = performance.getEntriesByName('cmt_TTI')[0]?.duration;
        const ttc = performance.getEntriesByName('cmt_TTC')[0]?.duration;
        console.log(`[Perf] Comments TTI: ${tti?.toFixed(0)}ms, TTC: ${ttc?.toFixed(0)}ms`);
      } catch (e) {
        // Ignore errors
      }
    }
  }, [commentStatus]);

  useEffect(() => {
    initializeCommentsStore();
  }, []);

  useEffect(() => {
    if (!featureFlags.comments) return;

    // Run loadComments and retryPending in parallel for faster initial load
    Promise.all([
      loadComments(cardId),
      retryPending().catch(error => {
        console.warn('Failed to retry pending comments on mount', error);
      })
    ]);
  }, [cardId, loadComments, retryPending]);

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

    // 1. Check store first (cache-first strategy)
    const storedData = getStoredMembers(boardId);
    if (storedData && storedData.length > 0) {
      setMembers(storedData.map(m => m.profile));
      // Set current user's role from stored data
      if (user?.id) {
        const currentMember = storedData.find(m => m.profile.id === user.id);
        if (currentMember) {
          setUserRole(currentMember.role);
        }
      }
      return;
    }

    // 2. Skip fetch if initialProfiles are provided (performance optimization)
    if (initialProfiles && initialProfiles.length > 0) {
      setMembers(initialProfiles);
      // Note: We don't have role info from initialProfiles yet
      // This is acceptable as role is only used for UI permissions
      return;
    }

    // 3. Fetch from API as last resort
    let ignore = false;

    const loadMembers = async () => {
      try {
        const response = await fetch(`/api/boards/${boardId}/members`);
        if (!response.ok) return;
        const { members: fetchedMembers } = await response.json();
        if (!ignore) {
          const memberProfiles = fetchedMembers.map((member: { profile: ProfileSummary }) => member.profile);
          setMembers(memberProfiles);

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
  }, [boardId, user?.id, initialProfiles, getStoredMembers]);

  useEffect(() => {
    if (!featureFlags.comments || !cardId) return;

    const channel = supabase
      .channel(`comments-${cardId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'comments',
          filter: `card_id=eq.${cardId}`,
        },
        () => {
          loadComments(cardId, true).catch((error) => {
            console.warn('[comments] failed to refresh after realtime event', error);
          });
        }
      );

    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[comments] realtime subscription issue:', status);
        loadComments(cardId, true).catch((error) => {
          console.warn('[comments] failed to refresh after subscription issue', error);
        });
      }
    });

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel).catch((error) => {
        console.warn('[comments] failed to remove realtime channel', error);
      });
    };
  }, [cardId, loadComments]);

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

  const handleSubmit = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
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
        // Clear input immediately before submission to avoid showing duplicate content
        setNewComment('');

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
          // Restore input on failure
          setNewComment(text);
        } else {
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
    const authorIdentity = comment.author
      ? resolveProfileIdentity(comment.author, comment.author.email ?? null)
      : null;
    const authorLabel = authorIdentity?.label ?? 'Unknown';
    const authorInitial = comment.author
      ? getProfileInitial(comment.author, comment.author.email ?? null)
      : 'U';

    return (
      <div
        key={comment.id}
        className={`border border-gray-200 dark:border-gray-700 rounded p-3 ${isReply ? 'ml-8 mt-2' : ''} ${comment.optimistic ? 'opacity-70' : ''}`}
      >
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0 flex items-center justify-center text-white font-medium">
            {authorInitial}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">
                {authorLabel}
              </div>
              <div className="text-xs text-gray-500">
                {new Date(comment.created_at).toLocaleString()}
              </div>
              {comment.optimistic && (
                <span className="text-xs text-sky-600 dark:text-sky-400">送信待ち...</span>
              )}
            </div>

            <div
              className="text-sm text-gray-600 dark:text-gray-400 mt-1"
              data-testid="comment-body"
            >
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
                <CommentEditor
                  key={`edit-${comment.id}-${members.length}`}
                  initialValue={editText}
                  onChange={setEditText}
                  onSubmit={handleSubmit}
                  placeholder="コメントを編集..."
                  profiles={members}
                  boardId={boardId}
                  autoFocus
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
            <CommentEditor
              key={`reply-${comment.id}-${members.length}`}
              initialValue={newComment}
              onChange={setNewComment}
              onSubmit={handleSubmit}
              placeholder="返信を書く..."
              profiles={members}
              boardId={boardId}
              autoFocus
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
    <div className="space-y-4" data-testid="comments-panel">
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
        <div className="space-y-2">
          {formError && (
            <div className="text-sm text-red-500">{formError}</div>
          )}
          <CommentEditor
            key={`new-comment-${members.length}`}
            initialValue={newComment}
            onChange={setNewComment}
            onSubmit={handleSubmit}
            placeholder="コメントを書く...（@でメンション、Shift+Enterで送信）"
            profiles={members}
            boardId={boardId}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !newComment.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? '送信中...' : 'コメントを投稿'}
          </button>
        </div>
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
