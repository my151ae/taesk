'use client';

import { useEffect } from 'react';
import { playNotificationSound, isAudioUnlocked, setupAutoUnlock } from '@/lib/notification-audio';

/**
 * Notification Sound Player Component
 *
 * Listens for Service Worker messages and plays notification sound when:
 * 1. Tab is visible
 * 2. Audio is unlocked
 * 3. Notification is received
 *
 * This implements the Google Chat/Slack pattern:
 * - Foreground tab: Play sound via Web Audio
 * - Background tab: OS notification only (sound depends on OS)
 */
export default function NotificationSoundPlayer() {
  useEffect(() => {
    // Setup auto-unlock on first user interaction
    setupAutoUnlock();

    // Listen for Service Worker messages
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_RECEIVED') {
        console.log('[NotificationSound] Received notification from SW:', event.data.payload);

        // Only play sound if tab is visible and audio is unlocked
        if (document.visibilityState === 'visible' && isAudioUnlocked()) {
          console.log('[NotificationSound] Tab is visible and audio unlocked, playing sound');
          playNotificationSound();
        } else {
          console.log('[NotificationSound] Tab is hidden or audio not unlocked, skipping sound');
          console.log('  - visibilityState:', document.visibilityState);
          console.log('  - audioUnlocked:', isAudioUnlocked());
        }
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage);
    }

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      }
    };
  }, []);

  // This component doesn't render anything
  return null;
}
