/**
 * Zustand store for notifications management
 * Handles notification state, fetching, marking as read, and real-time updates
 */

import { create } from 'zustand';
import { Notification } from '@/lib/supabase';

interface NotificationsState {
  notifications: Notification[];
  loading: boolean;
  error: string | null;
  unreadCount: number;

  // Actions
  setNotifications: (notifications: Notification[]) => void;
  addNotification: (notification: Notification) => void;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  fetchNotifications: () => Promise<void>;
  clearError: () => void;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  loading: false,
  error: null,
  unreadCount: 0,

  setNotifications: (notifications) => {
    const unreadCount = notifications.filter((n) => !n.read_at).length;
    set({ notifications, unreadCount });
  },

  addNotification: (notification) => {
    const { notifications } = get();
    const newNotifications = [notification, ...notifications];
    const unreadCount = newNotifications.filter((n) => !n.read_at).length;
    set({ notifications: newNotifications, unreadCount });
  },

  markAsRead: async (notificationId) => {
    try {
      const { notifications } = get();

      // Optimistic update
      const updatedNotifications = notifications.map((n) =>
        n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n
      );
      const unreadCount = updatedNotifications.filter((n) => !n.read_at).length;
      set({ notifications: updatedNotifications, unreadCount });

      // API call
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'PATCH',
      });

      if (!response.ok) {
        throw new Error('Failed to mark notification as read');
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
      set({ error: 'Failed to mark notification as read' });
      // Revert optimistic update
      get().fetchNotifications();
    }
  },

  markAllAsRead: async () => {
    try {
      const { notifications } = get();

      // Optimistic update
      const updatedNotifications = notifications.map((n) => ({
        ...n,
        read_at: n.read_at || new Date().toISOString(),
      }));
      set({ notifications: updatedNotifications, unreadCount: 0 });

      // API call
      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to mark all notifications as read');
      }
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      set({ error: 'Failed to mark all notifications as read' });
      // Revert optimistic update
      get().fetchNotifications();
    }
  },

  fetchNotifications: async () => {
    set({ loading: true, error: null });
    try {
      const response = await fetch('/api/notifications');
      if (!response.ok) {
        throw new Error('Failed to fetch notifications');
      }
      const { notifications } = await response.json();
      get().setNotifications(notifications);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      set({ error: 'Failed to load notifications' });
    } finally {
      set({ loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
