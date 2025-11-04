'use client';

import { create } from 'zustand';
import type { CommentWithAuthor, ProfileSummary } from '@/lib/supabase';
import {
  createComment,
  deleteComment,
  fetchComments,
  updateComment,
  type CreateCommentParams,
  type UpdateCommentParams,
} from '@/lib/api/comments';

type CommentStatus = 'idle' | 'loading' | 'ready' | 'error';

export type BoardComment = CommentWithAuthor & {
  optimistic?: boolean;
  errorMessage?: string;
  idempotencyKey?: string | null;
};

interface CardCommentState {
  comments: BoardComment[];
  status: CommentStatus;
  error?: string;
}

interface PendingComment {
  tempId: string;
  idempotencyKey: string;
  params: CreateCommentParams;
  authorProfile: ProfileSummary | null;
  authorId: string | null;
  addedAt: number;
}

interface SubmitCommentInput extends CreateCommentParams {
  authorProfile: ProfileSummary | null;
  authorId: string | null;
}

interface SubmitEditInput extends UpdateCommentParams {
  cardId: string;
}

interface CommentsStore {
  cards: Record<string, CardCommentState>;
  pendingQueue: PendingComment[];
  loadComments: (cardId: string, force?: boolean) => Promise<void>;
  upsertComment: (cardId: string, comment: BoardComment) => void;
  removeComment: (cardId: string, commentId: string) => void;
  submitComment: (input: SubmitCommentInput) => Promise<{ success: boolean; message?: string }>;
  submitEdit: (input: SubmitEditInput) => Promise<{ success: boolean; message?: string }>;
  submitDelete: (cardId: string, commentId: string) => Promise<{ success: boolean; message?: string }>;
  retryPending: () => Promise<void>;
  markError: (cardId: string, error: string) => void;
  clearError: (cardId: string) => void;
}

const COMMENT_QUEUE_KEY = 'taesk-comments-pending-comments';

const isBrowser = typeof window !== 'undefined';

const loadPendingQueue = (): PendingComment[] => {
  if (!isBrowser) return [];

  try {
    const raw = window.localStorage.getItem(COMMENT_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingComment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[comments-store] Failed to parse pending queue', error);
    return [];
  }
};

const persistPendingQueue = (queue: PendingComment[]) => {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(COMMENT_QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.warn('[comments-store] Failed to persist pending queue', error);
  }
};

const getInitialCardState = (): CardCommentState => ({
  comments: [],
  status: 'idle',
  error: undefined,
});

const isOffline = () => (typeof navigator !== 'undefined' ? !navigator.onLine : false);

const randomId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
};

const getTempId = () => `temp-${randomId()}`;

export const useCommentsStore = create<CommentsStore>((set, get) => ({
  cards: {},
  pendingQueue: loadPendingQueue(),

  loadComments: async (cardId, force = false) => {
    const { cards } = get();
    const state = cards[cardId] ?? getInitialCardState();

    if (!force && (state.status === 'loading' || state.status === 'ready')) {
      return;
    }

    set(prev => ({
      cards: {
        ...prev.cards,
        [cardId]: {
          ...state,
          status: 'loading',
          error: undefined,
        },
      },
    }));

    const result = await fetchComments(cardId);
    if (result.error) {
      set(prev => ({
        cards: {
          ...prev.cards,
          [cardId]: {
            ...prev.cards[cardId],
            status: 'error',
            error: result.error?.message ?? 'コメントの取得に失敗しました',
          },
        },
      }));
      return;
    }

    const optimisticExisting = state.comments?.filter(c => c.optimistic) ?? [];

    set(prev => ({
      cards: {
        ...prev.cards,
        [cardId]: {
          comments: [...(result.comments ?? []), ...optimisticExisting],
          status: 'ready',
          error: undefined,
        },
      },
    }));
  },

  upsertComment: (cardId, comment) => {
    set(prev => {
      const current = prev.cards[cardId] ?? getInitialCardState();
      const existing = current.comments.filter(existingComment => {
        if (existingComment.id === comment.id) return false;
        if (comment.idempotency_key && existingComment.idempotencyKey === comment.idempotency_key) {
          return false;
        }
        if (existingComment.optimistic && comment.idempotency_key && existingComment.idempotencyKey === comment.idempotency_key) {
          return false;
        }
        return true;
      });

      const next: CardCommentState = {
        comments: [...existing, { ...comment, optimistic: false, idempotencyKey: comment.idempotency_key ?? comment.idempotencyKey }],
        status: current.status === 'idle' ? 'ready' : current.status,
        error: current.error,
      };

      return {
        cards: {
          ...prev.cards,
          [cardId]: next,
        },
      };
    });
  },

  removeComment: (cardId, commentId) => {
    set(prev => {
      const current = prev.cards[cardId] ?? getInitialCardState();
      const next: CardCommentState = {
        ...current,
        comments: current.comments.filter(comment => comment.id !== commentId),
      };

      return {
        cards: {
          ...prev.cards,
          [cardId]: next,
        },
      };
    });
  },

  submitComment: async ({ cardId, body, mentions = [], parentId = null, authorProfile, authorId }) => {
    const idempotencyKey = randomId();
    const tempId = getTempId();
    const now = new Date().toISOString();

    const fallbackDisplayName = (authorProfile?.full_name && authorProfile.full_name.trim().length > 0)
      ? authorProfile.full_name.trim()
      : authorProfile?.email ?? 'Unknown user';
    const fallbackAuthor: ProfileSummary = {
      id: authorId ?? 'unknown',
      display_name: null,
      full_name: fallbackDisplayName,
      avatar_url: authorProfile?.avatar_url ?? null,
      email: authorProfile?.email ?? null,
    };

    const optimistic: BoardComment = {
      id: tempId,
      card_id: cardId,
      author_id: authorId ?? 'unknown',
      parent_id: parentId,
      body,
      mentions,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      author: authorProfile ?? fallbackAuthor,
      optimistic: true,
      idempotencyKey,
    };

    set(prev => {
      const current = prev.cards[cardId] ?? getInitialCardState();
      const next: CardCommentState = {
        comments: [...current.comments, optimistic],
        status: current.status === 'idle' ? 'ready' : current.status,
        error: current.error,
      };

      const nextQueue = [...prev.pendingQueue];

      if (isOffline()) {
        nextQueue.push({
          tempId,
          idempotencyKey,
          params: { cardId, body, mentions, parentId, idempotencyKey },
          authorProfile,
          authorId,
          addedAt: Date.now(),
        });
        persistPendingQueue(nextQueue);
      }

      return {
        cards: {
          ...prev.cards,
          [cardId]: next,
        },
        pendingQueue: nextQueue,
      };
    });

    if (isOffline()) {
      return { success: true, message: 'オフラインのため、復帰後に送信されます。' };
    }

    const result = await createComment({ cardId, body, mentions, parentId, idempotencyKey });
    if (!result || !result.comment) {
      set(prev => {
        const current = prev.cards[cardId] ?? getInitialCardState();
        const next: CardCommentState = {
          ...current,
          comments: current.comments.map(comment =>
            comment.id === tempId
              ? { ...comment, errorMessage: result?.error?.message ?? 'コメントの投稿に失敗しました' }
              : comment,
          ),
        };
        return {
          cards: {
            ...prev.cards,
            [cardId]: next,
          },
        };
      });

      return { success: false, message: result?.error?.message ?? 'コメントの投稿に失敗しました' };
    }

    get().upsertComment(cardId, { ...result.comment, idempotencyKey: idempotencyKey });
    return { success: true };
  },

  submitEdit: async ({ commentId, body, cardId }) => {
    const state = get();
    const current = state.cards[cardId] ?? getInitialCardState();
    const original = current.comments.find(comment => comment.id === commentId);
    if (!original) {
      return { success: false, message: 'コメントが見つかりませんでした' };
    }

    set(prev => {
      const updated: CardCommentState = {
        ...current,
        comments: current.comments.map(comment =>
          comment.id === commentId ? { ...comment, body, optimistic: true } : comment,
        ),
      };

      return {
        cards: {
          ...prev.cards,
          [cardId]: updated,
        },
      };
    });

    const result = await updateComment({ commentId, body });
    if (!result || !result.comment) {
      set(prev => {
        const rollback: CardCommentState = {
          ...current,
          comments: current.comments.map(comment =>
            comment.id === commentId ? { ...original, errorMessage: result?.error?.message ?? '更新に失敗しました' } : comment,
          ),
        };
        return {
          cards: {
            ...prev.cards,
            [cardId]: rollback,
          },
        };
      });
      return { success: false, message: result?.error?.message ?? 'コメントの更新に失敗しました' };
    }

    get().upsertComment(cardId, result.comment);
    return { success: true };
  },

  submitDelete: async (cardId, commentId) => {
    const { cards } = get();
    const current = cards[cardId] ?? getInitialCardState();
    const toDelete = current.comments.find(comment => comment.id === commentId);
    if (!toDelete) {
      return { success: false, message: 'コメントが見つかりませんでした' };
    }

    set(prev => {
      const next: CardCommentState = {
        ...current,
        comments: current.comments.filter(comment => comment.id !== commentId),
      };
      return {
        cards: {
          ...prev.cards,
          [cardId]: next,
        },
      };
    });

    const result = await deleteComment(commentId);
    if (!result.success) {
      // roll back
      set(prev => {
        const next: CardCommentState = {
          ...current,
          comments: [...current.comments, toDelete],
          error: result.error?.message ?? '削除に失敗しました',
          status: current.status,
        };
        return {
          cards: {
            ...prev.cards,
            [cardId]: next,
          },
        };
      });
      return { success: false, message: result.error?.message ?? 'コメントの削除に失敗しました' };
    }

    return { success: true };
  },

  retryPending: async () => {
    const { pendingQueue } = get();
    if (pendingQueue.length === 0) return;

    const stillPending: PendingComment[] = [];

    for (const entry of pendingQueue) {
      const { params, tempId, idempotencyKey, authorProfile } = entry;
      const result = await createComment(params);
      if (result?.comment) {
        get().upsertComment(params.cardId, { ...result.comment, idempotencyKey });
        set(prev => ({
          cards: {
            ...prev.cards,
            [params.cardId]: {
              ...(prev.cards[params.cardId] ?? getInitialCardState()),
              comments: (prev.cards[params.cardId]?.comments ?? []).filter(comment => comment.id !== tempId),
            },
          },
        }));
      } else {
        stillPending.push(entry);
        set(prev => ({
          cards: {
            ...prev.cards,
            [params.cardId]: {
              ...(prev.cards[params.cardId] ?? getInitialCardState()),
              comments: (prev.cards[params.cardId]?.comments ?? []).map(comment =>
                comment.id === tempId
                  ? {
                      ...comment,
                      errorMessage: result?.error?.message ?? '再送信に失敗しました',
                      author: authorProfile ?? comment.author,
                    }
                  : comment,
              ),
            },
          },
        }));
      }
    }

    persistPendingQueue(stillPending);
    set({ pendingQueue: stillPending });
  },

  markError: (cardId, error) => {
    set(prev => ({
      cards: {
        ...prev.cards,
        [cardId]: {
          ...(prev.cards[cardId] ?? getInitialCardState()),
          error,
          status: 'error',
        },
      },
    }));
  },

  clearError: cardId => {
    set(prev => ({
      cards: {
        ...prev.cards,
        [cardId]: {
          ...(prev.cards[cardId] ?? getInitialCardState()),
          error: undefined,
          status: (prev.cards[cardId]?.status ?? 'idle') === 'error' ? 'idle' : prev.cards[cardId]?.status ?? 'idle',
        },
      },
    }));
  },
}));

let listenersRegistered = false;

export const initializeCommentsStore = () => {
  if (!isBrowser || listenersRegistered) return;
  listenersRegistered = true;

  window.addEventListener('online', () => {
    useCommentsStore.getState().retryPending().catch(error => {
      console.warn('[comments-store] Failed to retry pending queue', error);
    });
  });
};
