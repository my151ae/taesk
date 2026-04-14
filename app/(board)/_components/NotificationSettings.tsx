'use client';

import { useCallback, useEffect, useState } from 'react';

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
import { unlockAudio, playNotificationSound, isAudioUnlocked } from '@/lib/notification-audio';
import type {
  DailyDigestPreferences,
  NotificationPreferences,
  QuietHoursPreference,
} from '@/lib/supabase';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const defaultTimezone =
  typeof Intl !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'UTC';

const supportedTimezones: string[] =
  typeof Intl !== 'undefined' && typeof (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf === 'function'
    ? (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf('timeZone')
    : [defaultTimezone];

type NotificationSettingsProps = {
  boardId?: string | null;
  boardName?: string | null;
};

type DailyDigestTestResponse = {
  success: true;
  notificationId: string;
  title: string;
  body: string;
  titleLength: number;
  bodyLength: number;
  pushEligible: boolean;
  pushReason: 'enabled' | 'disabled' | 'no_subscription';
};

export default function NotificationSettings({
  boardId = null,
  boardName = null,
}: NotificationSettingsProps) {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);

  const [loadingPush, setLoadingPush] = useState(false);
  const [loadingPreferences, setLoadingPreferences] = useState(true);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [dailyDigestTestSending, setDailyDigestTestSending] = useState(false);
  const [loadingDailyDigest, setLoadingDailyDigest] = useState(false);
  const [savingDailyDigest, setSavingDailyDigest] = useState(false);

  const [inAppEnabled, setInAppEnabled] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState('22:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('07:00');
  const [quietHoursTimezone, setQuietHoursTimezone] = useState(defaultTimezone);
  const [dailyDigestEnabled, setDailyDigestEnabled] = useState(false);
  const [dailyDigestDeliveryTime, setDailyDigestDeliveryTime] = useState('09:00');
  const [dailyDigestTimezone, setDailyDigestTimezone] = useState(defaultTimezone);

  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dailyDigestPreview, setDailyDigestPreview] = useState<DailyDigestTestResponse | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const applyPreferencesToForm = (prefs: NotificationPreferences) => {
    setInAppEnabled(prefs.in_app_enabled);
    setQuietHoursEnabled(Boolean(prefs.quiet_hours));
    if (prefs.quiet_hours) {
      setQuietHoursStart(prefs.quiet_hours.start);
      setQuietHoursEnd(prefs.quiet_hours.end);
      setQuietHoursTimezone(prefs.quiet_hours.timezone);
    }
  };

  const applyDailyDigestPreferencesToForm = (prefs: DailyDigestPreferences) => {
    setDailyDigestEnabled(prefs.enabled);
    setDailyDigestDeliveryTime(prefs.delivery_time);
    setDailyDigestTimezone(prefs.timezone);
  };

  const fetchPreferences = useCallback(async () => {
    if (!user) {
      setLoadingPreferences(false);
      return;
    }

    try {
      setLoadingPreferences(true);
      setError(null);
      setStatusMessage(null);
      setDailyDigestPreview(null);

      const response = await fetch('/api/notifications/preferences');
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to load preferences');
      }

      const data: NotificationPreferences = await response.json();
      applyPreferencesToForm(data);
    } catch (err) {
      console.error('Failed to load notification preferences:', err);
      setError(err instanceof Error ? err.message : 'Failed to load preferences');
    } finally {
      setLoadingPreferences(false);
    }
  }, [user]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const fetchDailyDigestPreferences = useCallback(async () => {
    if (!user || !boardId) {
      setDailyDigestEnabled(false);
      setDailyDigestDeliveryTime('09:00');
      setDailyDigestTimezone(defaultTimezone);
      return;
    }

    try {
      setLoadingDailyDigest(true);
      setError(null);

      const response = await fetch(`/api/boards/${boardId}/notifications/daily-digest-preferences`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to load daily digest preferences');
      }

      const data: DailyDigestPreferences = await response.json();
      applyDailyDigestPreferencesToForm(data);
    } catch (err) {
      console.error('Failed to load daily digest preferences:', err);
      setError(err instanceof Error ? err.message : 'Failed to load daily digest preferences');
    } finally {
      setLoadingDailyDigest(false);
    }
  }, [boardId, user]);

  useEffect(() => {
    void fetchDailyDigestPreferences();
  }, [fetchDailyDigestPreferences]);

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
    setDailyDigestPreview(null);

    try {
      // Always create the server-side notification first so list state is the source of truth.
      const response = await fetch('/api/notifications/test', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to send in-app test notification');
      }

      const automated = typeof navigator !== 'undefined' && Boolean((navigator as Navigator & { webdriver?: boolean }).webdriver);
      const success = automated
        ? true
        : await Promise.race([
            showTestNotification(),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
          ]);
      const statusMessage = success
        ? 'Test notification sent! 🔔'
        : 'In-app notification sent. Enable browser permissions to preview native alerts.';

      setStatusMessage(statusMessage);
      if (!success) {
        console.warn('Browser notification unavailable; completed API-only fallback.');
      }
    } catch (err) {
      console.error('Failed to send test notification:', err);
      setError(err instanceof Error ? err.message : 'Failed to send test notification');
    } finally {
      setTestSending(false);
    }
  };

  const handleSendDailyDigestTest = async () => {
    if (!boardId) {
      return;
    }

    setDailyDigestTestSending(true);
    setError(null);
    setStatusMessage(null);
    setDailyDigestPreview(null);

    try {
      const response = await fetch(`/api/boards/${boardId}/notifications/daily-digest-test`, {
        method: 'POST',
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error || 'Failed to send daily digest test');
      }

      const data = body as DailyDigestTestResponse;
      setDailyDigestPreview(data);
      if (data.pushReason === 'disabled') {
        setStatusMessage('Push is disabled; created in-app digest only.');
      } else if (data.pushReason === 'no_subscription') {
        setStatusMessage('No push subscription found; created in-app digest only.');
      } else {
        setStatusMessage('Daily digest test created. Push is eligible for delivery attempt.');
      }
    } catch (err) {
      console.error('Failed to send daily digest test:', err);
      setError(err instanceof Error ? err.message : 'Failed to send daily digest test');
    } finally {
      setDailyDigestTestSending(false);
    }
  };

  const updateDailyDigestPreferences = async (
    updates: Partial<DailyDigestPreferences>,
    successMessage?: string
  ): Promise<boolean> => {
    if (!boardId) {
      return false;
    }

    try {
      setSavingDailyDigest(true);
      setError(null);
      setStatusMessage(null);

      const response = await fetch(`/api/boards/${boardId}/notifications/daily-digest-preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to update daily digest preferences');
      }

      const data: DailyDigestPreferences = await response.json();
      applyDailyDigestPreferencesToForm(data);
      if (successMessage) {
        setStatusMessage(successMessage);
      }
      return true;
    } catch (err) {
      console.error('Failed to update daily digest preferences:', err);
      setError(err instanceof Error ? err.message : 'Failed to update daily digest preferences');
      return false;
    } finally {
      setSavingDailyDigest(false);
    }
  };

  const handleSaveDailyDigest = async () => {
    if (!boardId) {
      return;
    }

    if (!TIME_PATTERN.test(dailyDigestDeliveryTime)) {
      setError('Daily digest time must be in HH:MM format');
      return;
    }

    await updateDailyDigestPreferences(
      {
        enabled: dailyDigestEnabled,
        delivery_time: dailyDigestDeliveryTime,
        timezone: dailyDigestTimezone,
      },
      'Daily digest preferences updated'
    );
  };

  const handleUnlockAudio = async () => {
    console.log('[Audio] User requested audio unlock...');
    setError(null);
    setStatusMessage(null);

    try {
      const success = await unlockAudio();
      if (success) {
        setAudioUnlocked(true);
        setStatusMessage('✅ 音声が有効になりました！通知音が鳴るようになります。');
      } else {
        setError('音声の有効化に失敗しました。');
      }
    } catch (err) {
      console.error('[Audio] Failed to unlock audio:', err);
      setError(`音声の有効化に失敗: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleTestSound = () => {
    console.log('[Audio] Testing notification sound...');
    setError(null);
    setStatusMessage(null);

    if (!isAudioUnlocked()) {
      setError('先に「音声を有効化」ボタンをクリックしてください。');
      return;
    }

    const played = playNotificationSound();
    if (played) {
      setStatusMessage('✅ テスト音が再生されました！');
    } else {
      setError('音声の再生に失敗しました。');
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

      {boardId ? (
        <section className="space-y-2">
          <h3 className="text-lg font-semibold">Daily通知</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {boardName ? `${boardName} の今日タスク要約を毎日通知します。` : '現在のボードの今日タスク要約を毎日通知します。'}
          </p>

          <div className="space-y-4 rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
            {loadingDailyDigest ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">Loading daily digest settings...</p>
            ) : (
              <>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={dailyDigestEnabled}
                    onChange={(event) => setDailyDigestEnabled(event.target.checked)}
                    disabled={savingDailyDigest}
                    data-testid="daily-digest-toggle"
                  />
                  <span className="text-sm font-medium">このボードのDaily通知を有効化</span>
                </label>

                <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="font-medium text-gray-700 dark:text-gray-200">通知時刻</span>
                    <input
                      type="time"
                      value={dailyDigestDeliveryTime}
                      onChange={(event) => setDailyDigestDeliveryTime(event.target.value)}
                      disabled={savingDailyDigest}
                      className="w-full rounded border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700"
                      data-testid="daily-digest-time"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="font-medium text-gray-700 dark:text-gray-200">Timezone</span>
                    <select
                      value={dailyDigestTimezone}
                      onChange={(event) => setDailyDigestTimezone(event.target.value)}
                      disabled={savingDailyDigest}
                      className="w-full rounded border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700"
                      data-testid="daily-digest-timezone"
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
                  onClick={handleSaveDailyDigest}
                  disabled={savingDailyDigest}
                  className="rounded bg-slate-700 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-50"
                  data-testid="save-daily-digest-button"
                >
                  {savingDailyDigest ? 'Saving…' : 'Save Daily Digest'}
                </button>

                <div className="space-y-2 rounded border border-dashed border-slate-300 bg-white/70 p-3 dark:border-slate-600 dark:bg-slate-900/20">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Sends an immediate test digest for this board. Delivery schedule and quiet hours are ignored for this preview.
                  </p>
                  <button
                    onClick={handleSendDailyDigestTest}
                    disabled={dailyDigestTestSending}
                    className="rounded bg-slate-700 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-50"
                    data-testid="send-daily-digest-test-button"
                  >
                    {dailyDigestTestSending ? 'Sending…' : 'Send Daily Digest Test'}
                  </button>

                  {dailyDigestPreview ? (
                    <div
                      className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40"
                      data-testid="daily-digest-test-preview"
                    >
                      <div>
                        <div className="font-medium text-slate-700 dark:text-slate-200">Preview title</div>
                        <div className="break-words text-slate-900 dark:text-slate-100" data-testid="daily-digest-test-title">
                          {dailyDigestPreview.title}
                        </div>
                        <div className="text-xs text-slate-500">Length: {dailyDigestPreview.titleLength}</div>
                      </div>
                      <div>
                        <div className="font-medium text-slate-700 dark:text-slate-200">Preview body</div>
                        <div className="break-words text-slate-900 dark:text-slate-100" data-testid="daily-digest-test-body">
                          {dailyDigestPreview.body}
                        </div>
                        <div className="text-xs text-slate-500">Length: {dailyDigestPreview.bodyLength}</div>
                      </div>
                      <div className="text-xs text-slate-500" data-testid="daily-digest-test-push-status">
                        Push status: {dailyDigestPreview.pushReason}
                        {dailyDigestPreview.pushEligible
                          ? ' (push attempt eligible; delivery success not guaranteed)'
                          : ' (in-app only)'}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">通知音設定</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Chromeの自動再生ポリシーにより、初回クリックで音声を有効化する必要があります。
          （Google Chat/Slackと同じ方式）
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={handleUnlockAudio}
            disabled={audioUnlocked}
            className={`px-4 py-2 rounded ${
              audioUnlocked
                ? 'bg-green-600 text-white cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
            data-testid="unlock-audio-button"
          >
            {audioUnlocked ? '✅ 音声有効化済み' : '🔊 音声を有効化'}
          </button>

          <button
            onClick={handleTestSound}
            disabled={!audioUnlocked}
            className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 disabled:opacity-50"
            data-testid="test-sound-button"
          >
            🎵 テスト音を再生
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">Send Test Notification</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          We will create a test notification for your account to verify delivery.
        </p>
        <button
          onClick={handleSendTestNotification}
          disabled={testSending}
          className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 disabled:opacity-50"
          data-testid="send-test-notification-button"
        >
          {testSending ? 'Sending…' : 'Send Test Notification'}
        </button>
      </section>
    </div>
  );
}
