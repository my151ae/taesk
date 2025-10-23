import { test, expect } from '@playwright/test';

import { mockServiceWorkerAndPush } from './utils/push';

type QuietHours = { start: string; end: string; timezone: string };

async function openNotificationSettings(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Notification settings' }).click();
  await expect(page.getByRole('heading', { name: 'Notification Settings' })).toBeVisible();
}

test.describe('Web Push Notifications @feature:notifications', () => {
  let preferencesState: {
    in_app_enabled: boolean;
    web_push_enabled: boolean;
    quiet_hours: QuietHours | null;
  };
  let testNotificationCount: number;
  let pushSubscriptionCreates: number;
  let pushSubscriptionDeletes: number;

  test.beforeEach(async ({ page }) => {
    preferencesState = {
      in_app_enabled: true,
      web_push_enabled: false,
      quiet_hours: null,
    };
    testNotificationCount = 0;
    pushSubscriptionCreates = 0;
    pushSubscriptionDeletes = 0;

    await page.route('**/api/notifications/preferences', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            profile_id: 'mock-user',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...preferencesState,
          }),
        });
        return;
      }

      if (request.method() === 'PUT') {
        const payload = JSON.parse(request.postData() || '{}');
        if (payload.in_app_enabled !== undefined) {
          preferencesState.in_app_enabled = payload.in_app_enabled;
        }
        if (payload.web_push_enabled !== undefined) {
          preferencesState.web_push_enabled = payload.web_push_enabled;
        }
        if (payload.quiet_hours !== undefined) {
          preferencesState.quiet_hours = payload.quiet_hours;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            profile_id: 'mock-user',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...preferencesState,
          }),
        });
        return;
      }

      await route.fallback();
    });

    await page.route('**/api/notifications/test', async (route) => {
      if (route.request().method() === 'POST') {
        testNotificationCount += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      await route.fallback();
    });

    await page.route('**/api/push-subscriptions', async (route) => {
      const method = route.request().method();
      if (method === 'POST' || method === 'DELETE') {
        if (method === 'POST') {
          pushSubscriptionCreates += 1;
          preferencesState.web_push_enabled = true;
        } else {
          pushSubscriptionDeletes += 1;
          preferencesState.web_push_enabled = false;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }
      await route.fallback();
    });

    await mockServiceWorkerAndPush(page);
    await page.goto('/');
  });

  test('renders push notification controls', async ({ page }) => {
    await openNotificationSettings(page);

    await expect(page.locator('text=Browser Notifications', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('enable-push-button')).toBeVisible();
    await page.getByTestId('enable-push-button').click();
    await expect(page.getByTestId('enable-push-button')).toBeVisible();
  });

  test('configures quiet hours', async ({ page }) => {
    await openNotificationSettings(page);

    const quietToggle = page.getByTestId('quiet-hours-toggle');
    await quietToggle.check();
    await page.getByTestId('quiet-hours-start').fill('21:30');
    await page.getByTestId('quiet-hours-end').fill('06:15');
    const timezoneValue = await page
      .getByTestId('quiet-hours-timezone')
      .evaluate((select) => select.options[0]?.value || 'UTC');
    await page.getByTestId('quiet-hours-timezone').selectOption(timezoneValue);
    await page.getByTestId('save-quiet-hours-button').click();

    await expect
      .poll(() => preferencesState.quiet_hours)
      .toEqual({ start: '21:30', end: '06:15', timezone: timezoneValue });

    await quietToggle.uncheck();
    await page.getByTestId('save-quiet-hours-button').click();

    await expect
      .poll(() => preferencesState.quiet_hours)
      .toBeNull();
  });

  test('sends a test notification', async ({ page }) => {
    await openNotificationSettings(page);
    const beforeCount = testNotificationCount;

    await page.getByTestId('send-test-notification-button').click();

    await expect
      .poll(() => testNotificationCount - beforeCount)
      .toBeGreaterThan(0);
  });
});

test.describe('In-app Notifications @feature:notifications', () => {
  test('should display unread badge on NotificationsBell @e2e:essential', async ({ page }) => {
    await page.goto('/');

    // Mock notifications API to return unread notifications
    await page.route('**/api/notifications*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            notifications: [
              {
                id: crypto.randomUUID(),
                type: 'comment',
                title: 'New comment',
                body: 'Someone commented on your card',
                read: false,
                created_at: new Date().toISOString(),
              },
              {
                id: crypto.randomUUID(),
                type: 'mention',
                title: 'You were mentioned',
                body: 'Someone mentioned you in a comment',
                read: false,
                created_at: new Date().toISOString(),
              },
            ],
            unreadCount: 2,
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.reload();

    // Verify bell icon shows unread badge
    const bellButton = page.getByRole('button', { name: /notifications/i });
    await expect(bellButton).toBeVisible();

    // Badge should show "2"
    const badge = page.locator('[data-testid="notification-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('2');
  });

  test('should mark notifications as read and clear badge', async ({ page }) => {
    let markAsReadCalled = false;

    await page.goto('/');

    // Mock notifications API
    await page.route('**/api/notifications*', async (route) => {
      const url = route.request().url();

      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            notifications: [
              {
                id: 'notif-1',
                type: 'comment',
                title: 'New comment',
                body: 'Test notification',
                read: markAsReadCalled,
                created_at: new Date().toISOString(),
              },
            ],
            unreadCount: markAsReadCalled ? 0 : 1,
          }),
        });
        return;
      }

      if (route.request().method() === 'PATCH' && url.includes('/mark-read')) {
        markAsReadCalled = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      await route.fallback();
    });

    await page.reload();

    // Open notifications panel
    const bellButton = page.getByRole('button', { name: /notifications/i });
    await bellButton.click();

    // Verify notification is visible
    await expect(page.getByText('New comment')).toBeVisible();

    // Click "Mark all as read" or individual notification
    const markAllButton = page.getByRole('button', { name: /mark all as read/i });
    if (await markAllButton.isVisible()) {
      await markAllButton.click();
    }

    // Wait for mark-read API call
    await expect.poll(() => markAsReadCalled).toBe(true);

    // Reload to verify badge is cleared
    await page.reload();
    await expect(page.locator('[data-testid="notification-badge"]')).toHaveCount(0);
  });

  test('should handle empty notifications state @failure:notifications', async ({ page }) => {
    await page.goto('/');

    // Mock empty notifications response
    await page.route('**/api/notifications*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            notifications: [],
            unreadCount: 0,
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.reload();

    // Badge should not be visible when count is 0
    const badge = page.locator('[data-testid="notification-badge"]');
    await expect(badge).toHaveCount(0);

    // Open notifications panel
    const bellButton = page.getByRole('button', { name: /notifications/i });
    await bellButton.click();

    // Verify empty state message
    await expect(page.getByText(/no notifications/i)).toBeVisible();
  });
});
