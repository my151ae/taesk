'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { featureFlags } from '@/lib/featureFlags';
import { supabase, Notification } from '@/lib/supabase';
import { useAuth } from '@/app/contexts/AuthContext';
import { useNotificationsStore } from '@/app/(board)/_stores/notifications-store';
import type { RealtimeChannel } from '@supabase/supabase-js';

type TabType = 'all' | 'unread';

export default function NotificationsBell() {
  const { user } = useAuth();
  const router = useRouter();
  const [showDrawer, setShowDrawer] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const {
    notifications,
    loading,
    unreadCount,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    addNotification,
    startPolling,
    stopPolling,
  } = useNotificationsStore();

  // Initial load
  useEffect(() => {
    if (featureFlags.notifications && user?.id) {
      fetchNotifications();
    }
  }, [user?.id, fetchNotifications]);

  // Realtime subscription for notifications
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
          if (!newNotification) {
            return;
          }

          console.log('[Realtime] Notification payload received:', payload);
          addNotification(newNotification);
        }
      );

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[Realtime] Notifications channel subscribed');
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Realtime notifications subscription issue:', status);
        fetchNotifications({ silent: true });
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

  // Polling fallback to ensure updates even if realtime misses events
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

  // Close drawer when clicking outside
  useEffect(() => {
    if (!showDrawer) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(event.target as Node)) {
        setShowDrawer(false);
      }
    };

    // Add listener with a small delay to prevent immediate close
    const timerId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timerId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDrawer]);

  if (!featureFlags.notifications) {
    return null;
  }

  const filteredNotifications =
    activeTab === 'unread'
      ? notifications.filter((n) => !n.read_at)
      : notifications;

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read_at) {
      markAsRead(notification.id);
    }

    const payload = notification.payload;
    const cardId = payload.card_id || payload.cardId; // Handle both cases just in case
    const shortId = payload.short_id || payload.shortId;

    if (shortId) {
      router.push(`/c/${shortId}`);
      setShowDrawer(false);
    } else if (cardId) {
      // Fallback to cardId if shortId is missing. 
      // Note: /c/[id] might expect shortId, but let's try.
      // Ideally we should have shortId in payload.
      router.push(`/c/${cardId}`);
      setShowDrawer(false);
    }
  };

  const handleMarkAllAsRead = async () => {
    await markAllAsRead();
  };

  return (
    <div ref={drawerRef} className="relative">
      {/* Bell Icon Button */}
      <button
        onClick={() => setShowDrawer(!showDrawer)}
        className="relative p-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
        aria-label="Notifications"
      >
        <svg
          className="w-6 h-6"
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
            className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white transform translate-x-1/2 -translate-y-1/2 bg-red-500 rounded-full"
          >
            {unreadCount}
          </span>
        )}
      </button>

      {/* Drawer/Panel */}
      {showDrawer && (
        <>
          {/* Backdrop (mobile only) */}
          <div
            className="fixed inset-0 bg-black/20 z-40 md:hidden"
            onClick={() => setShowDrawer(false)}
          />

          {/* Drawer content */}
          <div className="fixed md:absolute right-0 top-0 md:top-full md:mt-2 w-full md:w-96 h-full md:h-auto md:max-h-[600px] bg-white dark:bg-gray-800 shadow-lg border-l md:border md:rounded-lg border-gray-200 dark:border-gray-700 z-50 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-lg">Notifications</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllAsRead}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setShowDrawer(false)}
                  className="md:hidden p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  aria-label="Close"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setActiveTab('all')}
                className={`flex-1 px-4 py-2 text-sm font-medium ${activeTab === 'all'
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
              >
                All ({notifications.length})
              </button>
              <button
                onClick={() => setActiveTab('unread')}
                className={`flex-1 px-4 py-2 text-sm font-medium ${activeTab === 'unread'
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
              >
                Unread ({unreadCount})
              </button>
            </div>

            {/* Notifications List */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-center text-gray-500">
                  <div className="animate-pulse">Loading...</div>
                </div>
              ) : filteredNotifications.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <svg
                    className="w-12 h-12 mx-auto mb-3 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                    />
                  </svg>
                  <p>No {activeTab === 'unread' ? 'unread ' : ''}notifications</p>
                </div>
              ) : (
                filteredNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`p-4 border-b border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${!notification.read_at ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex items-start gap-3">
                      {!notification.read_at && (
                        <div className="w-2 h-2 mt-1.5 bg-blue-600 rounded-full flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 dark:text-gray-100">
                          {notification.payload?.message || 'New notification'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {new Date(notification.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
