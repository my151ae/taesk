'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  registerServiceWorker,
  requestNotificationPermission,
  subscribeToPushNotifications,
  unsubscribeFromPushNotifications,
  savePushSubscription,
  deletePushSubscription,
  isPushNotificationSupported,
  getNotificationPermission,
} from '@/lib/push-notifications';

export default function NotificationSettings() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swRegistration, setSwRegistration] =
    useState<ServiceWorkerRegistration | null>(null);

  // Check initial state
  useEffect(() => {
    const checkStatus = async () => {
      if (!isPushNotificationSupported()) {
        setError('Push notifications are not supported in this browser');
        return;
      }

      setPermission(getNotificationPermission());

      // Register service worker
      const registration = await registerServiceWorker();
      setSwRegistration(registration);

      // Check if already subscribed
      if (registration) {
        const subscription = await registration.pushManager.getSubscription();
        setIsSubscribed(!!subscription);
      }
    };

    checkStatus();
  }, []);

  const handleEnablePushNotifications = async () => {
    setLoading(true);
    setError(null);

    try {
      // Request permission
      const perm = await requestNotificationPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        setError('Notification permission denied');
        return;
      }

      // Get service worker registration
      if (!swRegistration) {
        const registration = await registerServiceWorker();
        if (!registration) {
          throw new Error('Failed to register service worker');
        }
        setSwRegistration(registration);
      }

      // Subscribe to push notifications
      // TODO: Get VAPID public key from environment variables
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

      if (!vapidPublicKey) {
        throw new Error('VAPID public key not configured');
      }

      const subscription = await subscribeToPushNotifications(
        swRegistration!,
        vapidPublicKey
      );

      if (!subscription) {
        throw new Error('Failed to create push subscription');
      }

      // Save subscription to server
      const saved = await savePushSubscription(subscription);

      if (!saved) {
        throw new Error('Failed to save push subscription to server');
      }

      setIsSubscribed(true);
    } catch (err) {
      console.error('Error enabling push notifications:', err);
      setError(err instanceof Error ? err.message : 'Failed to enable push notifications');
    } finally {
      setLoading(false);
    }
  };

  const handleDisablePushNotifications = async () => {
    setLoading(true);
    setError(null);

    try {
      if (!swRegistration) {
        throw new Error('No service worker registration found');
      }

      // Get current subscription
      const subscription = await swRegistration.pushManager.getSubscription();

      if (subscription) {
        // Delete from server first
        await deletePushSubscription(subscription.endpoint);

        // Unsubscribe locally
        await unsubscribeFromPushNotifications(swRegistration);
      }

      setIsSubscribed(false);
    } catch (err) {
      console.error('Error disabling push notifications:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to disable push notifications'
      );
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return null;
  }

  if (!isPushNotificationSupported()) {
    return (
      <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded">
        <p className="text-sm text-yellow-800 dark:text-yellow-200">
          Push notifications are not supported in this browser.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-2">Push Notifications</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Get notified when someone mentions you, assigns you a card, or comments on your
          cards.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div>
          <div className="font-medium">Browser Notifications</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {permission === 'granted' && isSubscribed && 'Enabled'}
            {permission === 'granted' && !isSubscribed && 'Permission granted but not subscribed'}
            {permission === 'denied' && 'Permission denied'}
            {permission === 'default' && 'Not configured'}
          </div>
        </div>

        {permission === 'granted' && isSubscribed ? (
          <button
            onClick={handleDisablePushNotifications}
            disabled={loading}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
          >
            {loading ? 'Disabling...' : 'Disable'}
          </button>
        ) : (
          <button
            onClick={handleEnablePushNotifications}
            disabled={loading || permission === 'denied'}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
          >
            {loading ? 'Enabling...' : 'Enable'}
          </button>
        )}
      </div>

      {permission === 'denied' && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            You have blocked notifications. To enable them, please update your browser
            settings.
          </p>
        </div>
      )}

      <div className="text-xs text-gray-500 dark:text-gray-400">
        <p>
          • Notifications will be sent when you&apos;re mentioned in comments
        </p>
        <p>
          • You&apos;ll be notified when cards are assigned to you
        </p>
        <p>
          • Get updates on cards you&apos;re watching or participating in
        </p>
      </div>
    </div>
  );
}
