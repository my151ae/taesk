'use client';

import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { featureFlags } from '@/lib/featureFlags';
import { supabase, Notification } from '@/lib/supabase';
import { useAuth } from '@/app/contexts/AuthContext';
import { useNotificationsStore } from '@/app/(board)/_stores/notifications-store';

type NotificationsBellProps = {
  onOpenNotificationsPanel?: () => void;
};

export default function NotificationsBell({ onOpenNotificationsPanel }: NotificationsBellProps) {
  const { user } = useAuth();
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const {
    unreadCount,
    fetchNotifications,
    addNotification,
    startPolling,
    stopPolling,
  } = useNotificationsStore();

  useEffect(() => {
    if (featureFlags.notifications && user?.id) {
      void fetchNotifications();
    }
  }, [user?.id, fetchNotifications]);

  useEffect(() => {
    if (!featureFlags.notifications || !user?.id) return;

    const previousChannel = realtimeChannelRef.current;
    if (previousChannel) {
      previousChannel.unsubscribe();
      supabase.removeChannel(previousChannel).catch((error) => {
        console.warn('Failed to remove previous notifications channel:', error);
      });
    }

    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotification = payload.new as Notification | null;
          if (!newNotification) return;
          addNotification(newNotification);
        }
      );

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') return;
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Realtime notifications subscription issue:', status);
        void fetchNotifications({ silent: true });
      }
    });

    realtimeChannelRef.current = channel;

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel).catch((error) => {
        console.warn('Failed to remove notifications channel:', error);
      });

      if (realtimeChannelRef.current === channel) {
        realtimeChannelRef.current = null;
      }
    };
  }, [user?.id, addNotification, fetchNotifications]);

  useEffect(() => {
    if (!featureFlags.notifications || !user?.id) {
      stopPolling();
      return;
    }

    startPolling();

    return () => {
      stopPolling();
    };
  }, [user?.id, startPolling, stopPolling]);

  if (!featureFlags.notifications) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpenNotificationsPanel}
        data-focus-group="header"
        data-focus-part="control"
        className="relative cursor-pointer select-none rounded p-2 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        aria-label="Notifications"
      >
        <svg
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute right-0 top-0 inline-flex -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-red-500 px-2 py-1 text-xs font-bold leading-none text-white"
          >
            {unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
