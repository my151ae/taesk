'use client';

import { useEffect, useRef } from 'react';
import { useNotificationsStore } from '@/app/(board)/_stores/notifications-store';
import { initializeUnifiedBadge, setUnifiedBadge } from '@/lib/unified-badge';

const CUSTOM_EVENT = 'taesk:notification-received';

export default function NotificationBadgeListener() {
  const unreadCount = useNotificationsStore((state) => state.unreadCount);
  const pendingRef = useRef(unreadCount);

  // Initialize badge assets once on mount
  useEffect(() => {
    initializeUnifiedBadge();
  }, []);

  // Keep badge in sync with store updates
  useEffect(() => {
    pendingRef.current = unreadCount;
    void setUnifiedBadge(unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const bumpPendingBadge = () => {
      pendingRef.current = Math.max(unreadCount, pendingRef.current);
      pendingRef.current += 1;
      void setUnifiedBadge(pendingRef.current);
    };

    const handleCustomEvent = () => {
      bumpPendingBadge();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        pendingRef.current = unreadCount;
        void setUnifiedBadge(unreadCount);
      }
    };

    window.addEventListener(CUSTOM_EVENT, handleCustomEvent as EventListener);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    handleVisibility();

    return () => {
      window.removeEventListener(CUSTOM_EVENT, handleCustomEvent as EventListener);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [unreadCount]);

  return null;
}
