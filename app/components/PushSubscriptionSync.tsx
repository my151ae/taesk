'use client';

import { useEffect, useRef } from 'react';

import { useAuth } from '@/app/contexts/AuthContext';
import {
  getNotificationPermission,
  isPushNotificationSupported,
  registerServiceWorker,
  subscribeToPushNotifications,
  savePushSubscription,
} from '@/lib/push-notifications';

const MIN_SYNC_INTERVAL_MS = 60_000;
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

export default function PushSubscriptionSync() {
  const { user } = useAuth();
  const lastSyncAtRef = useRef(0);
  const syncInFlightRef = useRef(false);

  useEffect(() => {
    if (!user || typeof window === 'undefined') {
      return;
    }

    const syncExistingSubscription = async (reason: 'mount' | 'focus' | 'visibility' | 'online') => {
      if (syncInFlightRef.current) {
        return;
      }

      const now = Date.now();
      if (now - lastSyncAtRef.current < MIN_SYNC_INTERVAL_MS) {
        return;
      }

      if (!isPushNotificationSupported() || getNotificationPermission() !== 'granted') {
        return;
      }

      syncInFlightRef.current = true;

      try {
        const preferencesResponse = await fetch('/api/notifications/preferences', {
          cache: 'no-store',
        });

        if (!preferencesResponse.ok) {
          return;
        }

        const preferences = await preferencesResponse.json() as { web_push_enabled?: boolean };
        if (preferences.web_push_enabled !== true) {
          return;
        }

        const registration = await registerServiceWorker();
        let subscription = await registration?.pushManager.getSubscription();

        if (!subscription && registration && VAPID_PUBLIC_KEY) {
          subscription = await subscribeToPushNotifications(registration, VAPID_PUBLIC_KEY);
        }

        if (!subscription) {
          return;
        }

        const saved = await savePushSubscription(subscription);
        if (saved) {
          lastSyncAtRef.current = now;
          console.log('[PushSubscriptionSync] synced existing subscription:', reason);
        }
      } catch (error) {
        console.warn('[PushSubscriptionSync] failed to sync subscription:', error);
      } finally {
        syncInFlightRef.current = false;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncExistingSubscription('visibility');
      }
    };

    const handleFocus = () => {
      void syncExistingSubscription('focus');
    };

    const handleOnline = () => {
      void syncExistingSubscription('online');
    };

    void syncExistingSubscription('mount');

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, [user]);

  return null;
}
