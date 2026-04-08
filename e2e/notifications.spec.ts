import { test, expect } from '@playwright/test';

import { mockServiceWorkerAndPush } from './utils/push';

type QuietHours = { start: string; end: string; timezone: string };

function buildNotificationsResponse({
  notifications,
  unreadCount,
  hasMore = false,
  nextCursor = null,
}: {
  notifications: unknown[];
  unreadCount: number;
  hasMore?: boolean;
  nextCursor?: string | null;
}) {
  return JSON.stringify({
    notifications,
    unreadCount,
    hasMore,
    nextCursor,
  });
}

async function openNotificationSettings(page: import('@playwright/test').Page) {
  await page.getByTestId('board-main-header').getByRole('button', { name: /notifications/i }).click();
  await page.getByTestId('notification-settings-button').click();
  await expect(page.getByRole('heading', { name: 'Notification Settings' })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByTestId('enable-push-button')).toBeVisible({ timeout: 10000 });
}

test.describe('Web Push Notifications @feature:notifications', () => {
  let preferencesState: {
    in_app_enabled: boolean;
    web_push_enabled: boolean;
    quiet_hours: QuietHours | null;
  };
  let dailyDigestState: {
    enabled: boolean;
    delivery_time: string;
    timezone: string;
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
    dailyDigestState = {
      enabled: false,
      delivery_time: '09:00',
      timezone: 'Asia/Tokyo',
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

    await page.route('**/api/boards/*/notifications/daily-digest-preferences', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        const url = new URL(request.url());
        const segments = url.pathname.split('/');
        const boardId = segments[segments.indexOf('boards') + 1] || 'mock-board';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            profile_id: 'mock-user',
            board_id: boardId,
            include_overdue: true,
            notify_when_empty: true,
            last_sent_local_date: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...dailyDigestState,
          }),
        });
        return;
      }

      if (request.method() === 'PUT') {
        const payload = JSON.parse(request.postData() || '{}');
        if (payload.enabled !== undefined) {
          dailyDigestState.enabled = payload.enabled;
        }
        if (payload.delivery_time !== undefined) {
          dailyDigestState.delivery_time = payload.delivery_time;
        }
        if (payload.timezone !== undefined) {
          dailyDigestState.timezone = payload.timezone;
        }

        const url = new URL(request.url());
        const segments = url.pathname.split('/');
        const boardId = segments[segments.indexOf('boards') + 1] || 'mock-board';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            profile_id: 'mock-user',
            board_id: boardId,
            include_overdue: true,
            notify_when_empty: true,
            last_sent_local_date: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...dailyDigestState,
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

  test('configures daily digest preferences', async ({ page }) => {
    await openNotificationSettings(page);

    await page.getByTestId('daily-digest-toggle').check();
    await page.getByTestId('daily-digest-time').fill('08:15');
    const timezoneValue = await page
      .getByTestId('daily-digest-timezone')
      .evaluate((select) => (select as HTMLSelectElement).options[1]?.value || 'Asia/Tokyo');
    await page.getByTestId('daily-digest-timezone').selectOption(timezoneValue);
    await page.getByTestId('save-daily-digest-button').click();

    await expect.poll(() => dailyDigestState).toEqual({
      enabled: true,
      delivery_time: '08:15',
      timezone: timezoneValue,
    });
  });

  test('sends a test notification', async ({ page }) => {
    await openNotificationSettings(page);
    const beforeCount = testNotificationCount;

    const testResponsePromise = page.waitForResponse((res) => {
      return (
        res.request().method() === 'POST' &&
        res.url().includes('/api/notifications/test') &&
        res.ok()
      );
    }, { timeout: 10_000 });

    const sendButton = page.getByTestId('send-test-notification-button');
    await sendButton.scrollIntoViewIfNeeded();
    await sendButton.dispatchEvent('click');
    await testResponsePromise;
    await expect
      .poll(() => testNotificationCount, { timeout: 5_000 })
      .toBeGreaterThan(beforeCount);
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
            ...JSON.parse(buildNotificationsResponse({
              notifications: [
                {
                  id: crypto.randomUUID(),
                  type: 'comment',
                  payload: {
                    message: 'New comment',
                    body: 'Someone commented on your card',
                  },
                  read_at: null,
                  created_at: new Date().toISOString(),
                },
                {
                  id: crypto.randomUUID(),
                  type: 'mention',
                  payload: {
                    message: 'You were mentioned',
                    body: 'Someone mentioned you in a comment',
                  },
                  read_at: null,
                  created_at: new Date().toISOString(),
                },
              ],
              unreadCount: 2,
            })),
          }),
        });
        return;
      }
      await route.fallback();
    });

    // Wait for page to be stable before reloading
    await page.waitForLoadState('networkidle');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // Verify bell icon shows unread badge
    const bellButton = page.getByTestId('board-main-header').getByRole('button', { name: /notifications/i });
    await expect(bellButton).toBeVisible({ timeout: 10000 });

    // Badge should show "2"
    const badge = page.locator('[data-testid="notification-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('2');
  });

  test('should mark notifications as read and clear badge', async ({ page }) => {
    let markAsReadCalled = 0;

    // Setup route BEFORE navigation (正規表現で完全一致)
    await page.route(/\/api\/notifications\/mark-all-read$/, async (route) => {
      markAsReadCalled++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    // Mock GET notifications endpoint
    await page.route(/\/api\/notifications(\?.*)?$/, async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...JSON.parse(buildNotificationsResponse({
              notifications: [
                {
                  id: 'notif-1',
                  type: 'comment',
                  payload: {
                    message: 'New comment',
                    body: 'Test notification',
                  },
                  read_at: markAsReadCalled > 0 ? new Date().toISOString() : null,
                  created_at: new Date().toISOString(),
                },
              ],
              unreadCount: markAsReadCalled > 0 ? 0 : 1,
            })),
          }),
        });
        return;
      }
      await route.fallback();
    });

    // Debug logging (temporary)
    page.on('request', (req) => {
      if (req.url().includes('/notifications')) {
        console.log('Request:', req.method(), req.url());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open notifications panel
    const bellButton = page.getByTestId('board-main-header').getByRole('button', { name: /notifications/i });
    await bellButton.click();

    // Verify notification is visible
    await expect(page.getByText('New comment')).toBeVisible();

    // Click "Mark all as read"
    const markAllButton = page.getByRole('button', { name: /mark all read/i });
    await expect(markAllButton).toBeVisible();
    await markAllButton.click();

    // Wait for mark-read API call (ルートが呼ばれたことを保証)
    await expect.poll(() => markAsReadCalled, { timeout: 10000 }).toBeGreaterThan(0);

    // Wait for badge to disappear (DOM安定待ち)
    await expect(page.locator('[data-testid="notification-badge"]')).toBeHidden({ timeout: 10000 });
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
            ...JSON.parse(buildNotificationsResponse({
              notifications: [],
              unreadCount: 0,
            })),
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
    const bellButton = page.getByTestId('board-main-header').getByRole('button', { name: /notifications/i });
    await bellButton.click();

    // Verify empty state message
    await expect(page.getByText(/(no notifications|通知はありません)/i)).toBeVisible();
  });

  test('should expose Notifications in the mobile selector and open cards from the panel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await page.route(/\/api\/notifications\/[^/]+$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.route(/\/api\/notifications(\?.*)?$/, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...JSON.parse(buildNotificationsResponse({
              notifications: [
                {
                  id: 'notif-mobile-openable',
                  type: 'mention',
                  payload: {
                    card_title: 'Mobile Notification Card',
                    card_short_id: '1',
                    comment_body: 'mobile notification body',
                  },
                  read_at: null,
                  created_at: new Date().toISOString(),
                },
              ],
              unreadCount: 1,
            })),
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const bellButton = page.getByTestId('board-main-header').getByRole('button', { name: /notifications/i });
    await bellButton.click();

    await expect(page.getByTestId('mobile-left-panel-selector-trigger')).toHaveText(/notifications/i);
    await expect(page.getByTestId('mobile-left-panel-count-badge')).toHaveText('1');
    await expect(page.getByTestId('mobile-left-panel-body')).toBeVisible();
    await expect(page.getByText('Mobile Notification Card')).toBeVisible();

    await page.getByTestId('mobile-left-panel-selector-trigger').click();
    await expect(page.getByTestId('mobile-left-panel-selector-item-notifications')).toBeVisible();
    await page.getByTestId('mobile-left-panel-selector-item-overdue').click();
    await expect(page.getByTestId('mobile-left-panel-selector-trigger')).toHaveText(/overdue/i);

    await page.getByTestId('mobile-left-panel-selector-trigger').click();
    await page.getByTestId('mobile-left-panel-selector-item-notifications').click();
    await expect(page.getByText('Mobile Notification Card')).toBeVisible();

    await page.getByText('Mobile Notification Card').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText('Mobile Notification Card')).toBeVisible({ timeout: 10000 });
  });

  test('should load more notifications without dropping the current page', async ({ page }) => {
    const pageOneCursor = 'page-1-cursor';
    let firstPageRequests = 0;

    await page.route(/\/api\/notifications(\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }

      const url = new URL(route.request().url());
      const before = url.searchParams.get('before');

      if (before === pageOneCursor) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: buildNotificationsResponse({
            notifications: [
              {
                id: 'notif-older-1',
                type: 'comment',
                payload: {
                  card_title: 'Older Notification 1',
                  comment_body: 'older body 1',
                },
                read_at: null,
                created_at: '2026-04-08T09:00:00.000Z',
              },
              {
                id: 'notif-older-2',
                type: 'comment',
                payload: {
                  card_title: 'Older Notification 2',
                  comment_body: 'older body 2',
                },
                read_at: '2026-04-08T09:05:00.000Z',
                created_at: '2026-04-08T08:00:00.000Z',
              },
            ],
            unreadCount: 3,
            hasMore: false,
            nextCursor: null,
          }),
        });
        return;
      }

      firstPageRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildNotificationsResponse({
          notifications: [
            {
              id: 'notif-head-1',
              type: 'mention',
              payload: {
                card_title: 'Head Notification 1',
                comment_body: 'head body 1',
              },
              read_at: null,
              created_at: '2026-04-09T12:00:00.000Z',
            },
            {
              id: 'notif-head-2',
              type: 'comment',
              payload: {
                card_title: 'Head Notification 2',
                comment_body: 'head body 2',
              },
              read_at: null,
              created_at: '2026-04-09T11:00:00.000Z',
            },
          ],
          unreadCount: 3,
          hasMore: true,
          nextCursor: pageOneCursor,
        }),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('board-main-header').getByRole('button', { name: /notifications/i }).click();
    const desktopNotificationsPanel = page.getByTestId('desktop-sidebar-notifications-panel');

    await expect(desktopNotificationsPanel.getByText('Head Notification 1')).toBeVisible();
    await expect(desktopNotificationsPanel.getByText('Head Notification 2')).toBeVisible();

    const loadMoreButton = desktopNotificationsPanel.getByTestId('notifications-load-more');
    await expect(loadMoreButton).toBeVisible();
    await loadMoreButton.click();

    await expect(desktopNotificationsPanel.getByText('Older Notification 1')).toBeVisible();
    await expect(desktopNotificationsPanel.getByText('Older Notification 2')).toBeVisible();
    await expect(desktopNotificationsPanel.getByText('Head Notification 1')).toBeVisible();
    await expect(loadMoreButton).toHaveCount(0);
    await expect.poll(() => firstPageRequests, { timeout: 10_000 }).toBeGreaterThan(0);
  });
});
