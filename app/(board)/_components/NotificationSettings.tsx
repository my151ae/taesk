'use client';

import { useEffect, useMemo, useState } from 'react';

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
  showTestNotification,
} from '@/lib/push-notifications';
import type { NotificationPreferences, QuietHoursPreference } from '@/lib/supabase';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const defaultTimezone =
  typeof Intl !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'UTC';

const supportedTimezones: string[] =
  typeof Intl !== 'undefined' && typeof (Intl as any).supportedValuesOf === 'function'
    ? (Intl as any).supportedValuesOf('timeZone')
    : [defaultTimezone];

export default function NotificationSettings() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);

  const [loadingPush, setLoadingPush] = useState(false);
  const [loadingPreferences, setLoadingPreferences] = useState(true);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [testSending, setTestSending] = useState(false);

  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [inAppEnabled, setInAppEnabled] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState('22:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('07:00');
  const [quietHoursTimezone, setQuietHoursTimezone] = useState(defaultTimezone);

  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const applyPreferencesToForm = (prefs: NotificationPreferences) => {
    setInAppEnabled(prefs.in_app_enabled);
    setQuietHoursEnabled(Boolean(prefs.quiet_hours));
    if (prefs.quiet_hours) {
      setQuietHoursStart(prefs.quiet_hours.start);
      setQuietHoursEnd(prefs.quiet_hours.end);
      setQuietHoursTimezone(prefs.quiet_hours.timezone);
    }
  };

  const fetchPreferences = async () => {
    if (!user) {
      setLoadingPreferences(false);
      return;
    }

    try {
      setLoadingPreferences(true);
      setError(null);
      setStatusMessage(null);

      const response = await fetch('/api/notifications/preferences');
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to load preferences');
      }

      const data: NotificationPreferences = await response.json();
      setPreferences(data);
      applyPreferencesToForm(data);
    } catch (err) {
      console.error('Failed to load notification preferences:', err);
      setError(err instanceof Error ? err.message : 'Failed to load preferences');
    } finally {
      setLoadingPreferences(false);
    }
  };

  useEffect(() => {
    fetchPreferences();
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const initPush = async () => {
      if (!isPushNotificationSupported()) {
        setError('Push notifications are not supported in this browser');
        return;
      }

      setPermission(getNotificationPermission());

      const registration = await registerServiceWorker();
      setSwRegistration(registration);

      if (registration) {
        const subscription = await registration.pushManager.getSubscription();
        setIsSubscribed(Boolean(subscription));
      }
    };

    initPush().catch((err) => {
      console.error('Failed to initialize push notifications:', err);
      setError('Failed to initialize push notifications');
    });
  }, [user]);

  const pushPreferencesUpdate = async (
    updates: Partial<NotificationPreferences>,
    successMessage?: string
  ): Promise<boolean> => {
    try {
      setSavingPreferences(true);
      setError(null);
      setStatusMessage(null);

      const response = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to update preferences');
      }

      const data: NotificationPreferences = await response.json();
      setPreferences(data);
      applyPreferencesToForm(data);
      if (successMessage) {
        setStatusMessage(successMessage);
      }
      return true;
    } catch (err) {
      console.error('Failed to update notification preferences:', err);
      setError(err instanceof Error ? err.message : 'Failed to update preferences');
      return false;
    } finally {
      setSavingPreferences(false);
    }
  };

  const handleToggleInApp = async (checked: boolean) => {
    const previous = inAppEnabled;
    setInAppEnabled(checked);
    const ok = await pushPreferencesUpdate({ in_app_enabled: checked }, 'Preferences updated');
    if (!ok) {
      setInAppEnabled(previous);
    }
  };

  const handleEnablePushNotifications = async () => {
    setLoadingPush(true);
    setError(null);
    setStatusMessage(null);

    try {
      if (!isPushNotificationSupported()) {
        throw new Error('Push notifications are not supported in this browser');
      }

      const perm = await requestNotificationPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        throw new Error('Notification permission denied');
      }

      let registration = swRegistration;
      if (!registration) {
        registration = await registerServiceWorker();
        if (!registration) {
          throw new Error('Failed to register service worker');
        }
        setSwRegistration(registration);
      }

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
      if (!vapidPublicKey) {
        throw new Error('VAPID public key not configured');
      }

      const subscription = await subscribeToPushNotifications(registration, vapidPublicKey);
      if (!subscription) {
        throw new Error('Failed to create push subscription');
      }

      const saved = await savePushSubscription(subscription);
      if (!saved) {
        throw new Error('Failed to save push subscription');
      }

      setIsSubscribed(true);
      await pushPreferencesUpdate({ web_push_enabled: true }, 'Push notifications enabled');
    } catch (err) {
      console.error('Error enabling push notifications:', err);
      setError(err instanceof Error ? err.message : 'Failed to enable push notifications');
    } finally {
      setLoadingPush(false);
    }
  };

  const handleDisablePushNotifications = async () => {
    setLoadingPush(true);
    setError(null);
    setStatusMessage(null);

    try {
      if (!swRegistration) {
        throw new Error('No service worker registration found');
      }

      const subscription = await swRegistration.pushManager.getSubscription();
      if (subscription) {
        await deletePushSubscription(subscription.endpoint);
        await unsubscribeFromPushNotifications(swRegistration);
      }

      setIsSubscribed(false);
      await pushPreferencesUpdate({ web_push_enabled: false }, 'Push notifications disabled');
    } catch (err) {
      console.error('Error disabling push notifications:', err);
      setError(err instanceof Error ? err.message : 'Failed to disable push notifications');
    } finally {
      setLoadingPush(false);
    }
  };

  const handleSaveQuietHours = async () => {
    if (quietHoursEnabled) {
      if (!TIME_PATTERN.test(quietHoursStart) || !TIME_PATTERN.test(quietHoursEnd)) {
        setError('Quiet hours must be in HH:MM format');
        return;
      }

      const quietHours: QuietHoursPreference = {
        start: quietHoursStart,
        end: quietHoursEnd,
        timezone: quietHoursTimezone,
      };

      await pushPreferencesUpdate({ quiet_hours: quietHours }, 'Quiet hours updated');
    } else {
      await pushPreferencesUpdate({ quiet_hours: null }, 'Quiet hours disabled');
    }
  };

  const handleSendTestNotification = async () => {
    setTestSending(true);
    setError(null);
    setStatusMessage(null);

    try {
      // Show browser notification with sound
      const success = await showTestNotification();

      if (!success) {
        throw new Error('Failed to show notification. Please check permissions.');
      }

      setStatusMessage('Test notification sent! 🔔');

      // Also send via API for in-app notification
      fetch('/api/notifications/test', { method: 'POST' }).catch(err => {
        console.error('Failed to send in-app test notification:', err);
      });
    } catch (err) {
      console.error('Failed to send test notification:', err);
      setError(err instanceof Error ? err.message : 'Failed to send test notification');
    } finally {
      setTestSending(false);
    }
  };

  const handleTestSound = async () => {
    console.log('[Notification Test] Testing system notification sound...');

    try {
      // Check notification permission
      if (Notification.permission !== 'granted') {
        setError('Notification permission not granted. Please enable notifications first.');
        return;
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Show notification with sound request (uses Notification API, not Audio API)
      await registration.showNotification('Taesk Sound Test', {
        body: 'Testing system notification sound with Notification API',
        icon: '/icon?size=192',
        badge: '/icon?size=192',
        tag: `sound-test-${Date.now()}`, // Unique tag for each test
        silent: false,      // Request system sound (depends on browser/OS settings)
      });

      console.log('[Notification Test] Notification shown with sound request');
      setStatusMessage('Test notification sent with system sound request ✅ (Sound depends on Chrome/OS settings)');
    } catch (err) {
      console.error('[Notification Test] Failed:', err);
      setError(`Notification test failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!user) {
    return null;
  }

  if (loadingPreferences) {
    return (
      <div className="p-4 text-sm text-gray-600 dark:text-gray-400">
        Loading notification settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {statusMessage && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded">
          <p className="text-sm text-green-800 dark:text-green-200">{statusMessage}</p>
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">In-App Notifications</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Show notifications inside Taesk when you are mentioned or assigned to a card.
        </p>

        <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div>
            <div className="font-medium">In-App Alerts</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {inAppEnabled ? 'Enabled' : 'Disabled'}
            </div>
          </div>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={inAppEnabled}
              onChange={(event) => handleToggleInApp(event.target.checked)}
              disabled={savingPreferences}
              data-testid="in-app-toggle"
            />
            <span className="text-sm font-medium">Enabled</span>
          </label>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">Push Notifications</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Receive browser notifications when teammates mention you, reply to your comments, or assign you to a card.
        </p>

        {!isPushNotificationSupported() ? (
          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              Push notifications are not supported in this browser.
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div>
              <div className="font-medium">Browser Notifications</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {permission === 'granted' && isSubscribed && 'Enabled'}
                {permission === 'granted' && !isSubscribed &&
                  'Permission granted but not subscribed'}
                {permission === 'denied' && 'Permission denied'}
                {permission === 'default' && 'Not configured'}
              </div>
            </div>

            {permission === 'granted' && isSubscribed ? (
              <button
                onClick={handleDisablePushNotifications}
                disabled={loadingPush}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                data-testid="disable-push-button"
              >
                {loadingPush ? 'Disabling…' : 'Disable'}
              </button>
            ) : (
              <button
                onClick={handleEnablePushNotifications}
                disabled={loadingPush || permission === 'denied'}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                data-testid="enable-push-button"
              >
                {loadingPush ? 'Enabling…' : 'Enable'}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">Quiet Hours</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Automatically mute notifications during specific hours.
        </p>

        <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={quietHoursEnabled}
              onChange={(event) => setQuietHoursEnabled(event.target.checked)}
              disabled={savingPreferences}
              data-testid="quiet-hours-toggle"
            />
            <span className="text-sm font-medium">Enable quiet hours</span>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <label className="space-y-1">
              <span className="font-medium text-gray-700 dark:text-gray-200">Start</span>
              <input
                type="time"
                value={quietHoursStart}
                onChange={(event) => setQuietHoursStart(event.target.value)}
                disabled={!quietHoursEnabled || savingPreferences}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                data-testid="quiet-hours-start"
              />
            </label>

            <label className="space-y-1">
              <span className="font-medium text-gray-700 dark:text-gray-200">End</span>
              <input
                type="time"
                value={quietHoursEnd}
                onChange={(event) => setQuietHoursEnd(event.target.value)}
                disabled={!quietHoursEnabled || savingPreferences}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                data-testid="quiet-hours-end"
              />
            </label>

            <label className="space-y-1">
              <span className="font-medium text-gray-700 dark:text-gray-200">Timezone</span>
              <select
                value={quietHoursTimezone}
                onChange={(event) => setQuietHoursTimezone(event.target.value)}
                disabled={!quietHoursEnabled || savingPreferences}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                data-testid="quiet-hours-timezone"
              >
                {supportedTimezones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            onClick={handleSaveQuietHours}
            disabled={savingPreferences}
            className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 disabled:opacity-50"
            data-testid="save-quiet-hours-button"
          >
            {savingPreferences ? 'Saving…' : 'Save Quiet Hours'}
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">Send Test Notification</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          We will create a test notification for your account to verify delivery.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleSendTestNotification}
            disabled={testSending}
            className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 disabled:opacity-50"
            data-testid="send-test-notification-button"
          >
            {testSending ? 'Sending…' : 'Send Test Notification'}
          </button>
          <button
            onClick={handleTestSound}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            data-testid="test-sound-button"
          >
            Test Sound Only
          </button>
        </div>
      </section>
    </div>
  );
}
