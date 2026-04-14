/**
 * Zustand store for notifications management
 * Handles notification state, fetching, marking as read, and real-time updates
 */

import { create } from 'zustand';
import { Notification } from '@/lib/supabase';
import { setUnifiedBadge } from '@/lib/unified-badge';

const NOTIFICATIONS_PAGE_SIZE = 20;

type NotificationsPageResponse = {
  notifications: Notification[];
  unreadCount: number;
  hasMore: boolean;
  nextCursor: string | null;
};

function mergeUniqueNotifications(
  incoming: readonly Notification[],
  existing: readonly Notification[],
) {
  const merged = [...incoming];
  const seenIds = new Set(incoming.map((notification) => notification.id));

  existing.forEach((notification) => {
    if (seenIds.has(notification.id)) return;
    seenIds.add(notification.id);
    merged.push(notification);
  });

  return merged;
}

interface NotificationsState {
  notifications: Notification[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  unreadCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  initialized: boolean;
  pollingIntervalId: ReturnType<typeof setInterval> | null;

  // Actions
  setNotificationsPage: (
    payload: NotificationsPageResponse,
    options?: { mode?: 'replace' | 'merge-head' | 'append' }
  ) => void;
  addNotification: (notification: Notification) => void;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  fetchNotifications: (options?: { silent?: boolean }) => Promise<void>;
  fetchMoreNotifications: () => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;
  clearError: () => void;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  loading: false,
  loadingMore: false,
  error: null,
  unreadCount: 0,
  hasMore: false,
  nextCursor: null,
  initialized: false,
  pollingIntervalId: null,

  setNotificationsPage: (payload, options) => {
    const mode = options?.mode ?? 'replace';

    set((state) => {
      const nextNotifications =
        mode === 'append'
          ? mergeUniqueNotifications(state.notifications, payload.notifications)
              .sort((left, right) => {
                const createdAtDiff = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
                if (createdAtDiff !== 0) return createdAtDiff;
                return right.id.localeCompare(left.id);
              })
          : mode === 'merge-head'
            ? mergeUniqueNotifications(payload.notifications, state.notifications)
            : [...payload.notifications];

      const preservePagination = mode === 'merge-head' && state.notifications.length > payload.notifications.length;
      const nextState = {
        notifications: nextNotifications,
        unreadCount: payload.unreadCount,
        hasMore: preservePagination ? state.hasMore : payload.hasMore,
        nextCursor: preservePagination ? state.nextCursor : payload.nextCursor,
        initialized: true,
      };

      void setUnifiedBadge(nextState.unreadCount);
      return nextState;
    });
  },

  addNotification: (notification) => {
    set((state) => {
      const notifications = mergeUniqueNotifications([notification], state.notifications);
      const unreadCount = notification.read_at ? state.unreadCount : state.unreadCount + 1;
      void setUnifiedBadge(unreadCount);
      return {
        notifications,
        unreadCount,
        initialized: true,
      };
    });
  },

  markAsRead: async (notificationId) => {
    try {
      const readAt = new Date().toISOString();
      set((state) => {
        const target = state.notifications.find((notification) => notification.id === notificationId);
        const alreadyRead = !target || Boolean(target.read_at);
        const unreadCount = alreadyRead ? state.unreadCount : Math.max(0, state.unreadCount - 1);
        const notifications = state.notifications.map((notification) =>
          notification.id === notificationId ? { ...notification, read_at: readAt } : notification
        );

        void setUnifiedBadge(unreadCount);
        return { notifications, unreadCount };
      });

      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'PATCH',
      });

      if (!response.ok) {
        throw new Error('Failed to mark notification as read');
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
      set({ error: 'Failed to mark notification as read' });
      get().fetchNotifications();
    }
  },

  markAllAsRead: async () => {
    try {
      const readAt = new Date().toISOString();
      set((state) => ({
        notifications: state.notifications.map((notification) => ({
          ...notification,
          read_at: notification.read_at || readAt,
        })),
        unreadCount: 0,
      }));
      void setUnifiedBadge(0);

      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to mark all notifications as read');
      }
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      set({ error: 'Failed to mark all notifications as read' });
      get().fetchNotifications();
    }
  },

  fetchNotifications: async (options) => {
    const { initialized } = get();
    const silent = options?.silent ?? false;
    if (!silent) {
      set({ loading: true, error: null });
    } else {
      set({ error: null });
    }

    try {
      const params = new URLSearchParams({
        limit: String(NOTIFICATIONS_PAGE_SIZE),
      });
      const response = await fetch(`/api/notifications?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch notifications');
      }
      const payload = await response.json() as NotificationsPageResponse;
      get().setNotificationsPage(payload, {
        mode: silent && initialized ? 'merge-head' : 'replace',
      });
    } catch (error) {
      console.error('Error fetching notifications:', error);
      set({ error: 'Failed to load notifications' });
    } finally {
      set({ loading: false });
    }
  },

  fetchMoreNotifications: async () => {
    const { nextCursor, hasMore, loadingMore } = get();
    if (!nextCursor || !hasMore || loadingMore) {
      return;
    }

    set({ loadingMore: true, error: null });

    try {
      const params = new URLSearchParams({
        limit: String(NOTIFICATIONS_PAGE_SIZE),
        before: nextCursor,
      });
      const response = await fetch(`/api/notifications?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch more notifications');
      }
      const payload = await response.json() as NotificationsPageResponse;
      get().setNotificationsPage(payload, { mode: 'append' });
    } catch (error) {
      console.error('Error fetching more notifications:', error);
      set({ error: 'Failed to load more notifications' });
    } finally {
      set({ loadingMore: false });
    }
  },

  startPolling: (intervalMs = 10000) => {
    const { pollingIntervalId } = get();
    if (pollingIntervalId) {
      return;
    }

    const id = setInterval(() => {
      get()
        .fetchNotifications({ silent: true })
        .catch((error) => {
          console.warn('Failed to poll notifications:', error);
        });
    }, intervalMs);

    set({ pollingIntervalId: id });
  },

  stopPolling: () => {
    const { pollingIntervalId } = get();
    if (pollingIntervalId) {
      clearInterval(pollingIntervalId);
      set({ pollingIntervalId: null });
    }
  },

  clearError: () => set({ error: null }),
}));
