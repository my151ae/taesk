'use client';

import type { CreateCommentParams } from '@/lib/api/comments';
import type { ProfileSummary } from '@/lib/supabase';

export interface PendingComment {
  tempId: string;
  idempotencyKey: string;
  params: CreateCommentParams;
  authorProfile: ProfileSummary | null;
  authorId: string | null;
  addedAt: number;
}

const COMMENT_QUEUE_KEY = 'taesk-comments-pending-comments';
const isBrowser = typeof window !== 'undefined';

export const isOffline = () => (typeof navigator !== 'undefined' ? !navigator.onLine : false);

export const randomId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
};

export const getTempId = () => `temp-${randomId()}`;

export const loadPendingQueue = (): PendingComment[] => {
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

export const persistPendingQueue = (queue: PendingComment[]) => {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(COMMENT_QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.warn('[comments-store] Failed to persist pending queue', error);
  }
};
