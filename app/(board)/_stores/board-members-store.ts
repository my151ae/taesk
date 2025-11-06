'use client';

import { create } from 'zustand';
import type { ProfileSummary, MemberRole } from '@/lib/supabase';

export type BoardMember = {
  profile: ProfileSummary;
  role: MemberRole;
};

type State = {
  byBoardId: Record<string, BoardMember[]>;
  loadedAt: Record<string, number>;
};

type Actions = {
  setMembers: (boardId: string, members: BoardMember[]) => void;
  getMembers: (boardId: string) => BoardMember[] | undefined;
  shouldRefetch: (boardId: string, ttlMs?: number) => boolean;
  clear: () => void;
};

const DEFAULT_TTL = 5 * 60 * 1000; // 5分

export const useBoardMembersStore = create<State & Actions>((set, get) => ({
  byBoardId: {},
  loadedAt: {},

  setMembers: (boardId, members) => {
    set(state => ({
      byBoardId: { ...state.byBoardId, [boardId]: members },
      loadedAt: { ...state.loadedAt, [boardId]: Date.now() }
    }));
  },

  getMembers: (boardId) => {
    return get().byBoardId[boardId];
  },

  shouldRefetch: (boardId, ttlMs = DEFAULT_TTL) => {
    const loadedAt = get().loadedAt[boardId];
    if (!loadedAt) return true;
    return Date.now() - loadedAt > ttlMs;
  },

  clear: () => {
    set({ byBoardId: {}, loadedAt: {} });
  },
}));
