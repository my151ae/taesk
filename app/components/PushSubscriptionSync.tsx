'use client';

import { useEffect, useRef } from 'react';

import { useAuth } from '@/app/contexts/AuthContext';
import {
  getNotificationPermission,
  isPushNotificationSupported,
  registerServiceWorker,
  savePushSubscription,
} from '@/lib/push-notifications';

const MIN_SYNC_INTERVAL_MS = 60_000;

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
        const registration = await registerServiceWorker();
        const subscription = await registration?.pushManager.getSubscription();

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
