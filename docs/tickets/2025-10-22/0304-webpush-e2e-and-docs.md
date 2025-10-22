# 0304 Web Push E2Eテスト & ドキュメント整備

**作成日**: 2025-10-22
**親チケット**: 0209 E2Eテスト整備 & ドキュメント更新 (未完了分)
**優先度**: **Priority 3**
**担当候補**: QA + ドキュメント担当

---

## 🎯 ゴール
- 0209 で「100% 完了」と主張されていたが、実際には Web Push 関連が未実装だった E2E テストとドキュメントを完成させる
- Web Push の動作を自動テストで検証できるようにする
- 開発者が通知機能を理解し、トラブルシュートできるドキュメントを整備する

---

## 📝 背景
0301-status.md の検証結果、0209 は以下の状態であることが判明:
- ✅ `e2e/phase3-comments.spec.ts` 作成済み
- ✅ `docs/roadmap.md`, `docs/detail/architecture.md`, `docs/detail/testing.md` 更新済み
- ❌ Web Push E2E テスト未作成
- ❌ Web Push モック戦略未実装
- ❌ `docs/detail/notifications.md` 未作成
- ❌ `docs/releases/` ディレクトリ未作成
- ❌ `docs/setup/local-dev.md` に SW 手順未追記

**実装完了率**: 50% → 100% へ引き上げ

---

## ✅ スコープ

### 1. **Web Push E2E テストの作成**
- `e2e/phase3-webpush.spec.ts` (新規)
- Service Worker モックを利用したテスト
- 通知許可・購読・受信までのフロー検証

### 2. **Web Push モック戦略の実装**
- `e2e/utils/push.ts` (新規)
- Service Worker API のスタブ化
- Push イベントのシミュレーション

### 3. **`docs/detail/notifications.md` の作成**
- 通知生成フロー
- Web Push 設定手順
- トラブルシュート FAQ

### 4. **`docs/releases/` の作成**
- リリースノート執筆
- Phase 3 のハイライト
- 既知の制約・ロールアウト手順

### 5. **`docs/setup/local-dev.md` の更新**
- Service Worker 登録手順
- VAPID 鍵設定手順
- ローカル開発での注意事項

---

## 🚫 非スコープ
- iOS デバイスでの自動テスト (手動検証のみ)
- Supabase Edge Function のユニットテスト (別途検討)

---

## 📦 実装タスク

### **タスク 1: Web Push E2E テストの作成**

#### 1-1. `e2e/utils/push.ts` の作成
- [ ] ファイル作成: `e2e/utils/push.ts`
- [ ] Service Worker モック関数を実装

```typescript
import { Page } from '@playwright/test';

/**
 * Mock Service Worker and Push API for E2E tests
 */
export async function mockServiceWorkerAndPush(page: Page) {
  await page.addInitScript(() => {
    // Mock Service Worker registration
    const originalRegister = navigator.serviceWorker.register;
    navigator.serviceWorker.register = async (scriptURL: string, options?: RegistrationOptions) => {
      console.log('[Mock] Service Worker registered:', scriptURL);

      // Create mock registration
      const mockRegistration: ServiceWorkerRegistration = {
        active: {
          state: 'activated',
          postMessage: () => {},
        } as any,
        installing: null,
        waiting: null,
        scope: '/',
        updateViaCache: 'imports',
        pushManager: {
          subscribe: async (options: PushSubscriptionOptionsInit) => {
            console.log('[Mock] Push subscription created');
            return {
              endpoint: 'https://mock-push-service.example.com/test',
              toJSON: () => ({
                endpoint: 'https://mock-push-service.example.com/test',
                keys: {
                  p256dh: 'mock-p256dh-key',
                  auth: 'mock-auth-key',
                },
              }),
            } as PushSubscription;
          },
          getSubscription: async () => null,
        } as any,
        showNotification: async (title: string, options?: NotificationOptions) => {
          console.log('[Mock] Notification shown:', title, options);
        },
        getNotifications: async () => [],
      } as any;

      return mockRegistration;
    };

    // Mock Notification.requestPermission
    const originalRequestPermission = Notification.requestPermission;
    Notification.requestPermission = async () => {
      console.log('[Mock] Notification permission requested');
      return 'granted' as NotificationPermission;
    };

    // Override Notification.permission
    Object.defineProperty(Notification, 'permission', {
      get: () => 'default',
      configurable: true,
    });
  });
}

/**
 * Simulate receiving a push notification
 */
export async function simulatePushNotification(
  page: Page,
  payload: { title: string; body: string; data?: any }
) {
  await page.evaluate((payload) => {
    // Trigger push event
    const event = new Event('push');
    (event as any).data = {
      json: () => payload,
    };

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.dispatchEvent(event);
    }

    // Also show notification directly for testing
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(payload.title, {
        body: payload.body,
        data: payload.data,
      });
    }
  }, payload);
}
```

#### 1-2. `e2e/phase3-webpush.spec.ts` の作成
- [ ] ファイル作成: `e2e/phase3-webpush.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { mockServiceWorkerAndPush, simulatePushNotification } from './utils/push';

test.describe('Web Push Notifications @webpush', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Service Worker and Push API
    await mockServiceWorkerAndPush(page);

    // Navigate to app
    await page.goto('http://localhost:3000');

    // Login (assuming auth is set up)
    // ... login code
  });

  test('should enable push notifications', async ({ page }) => {
    // Open notification settings
    await page.click('[aria-label="Notifications"]');
    await page.click('text=Settings');

    // Click "Enable Push Notifications"
    await page.click('text=Enable Push Notifications');

    // Should show success message
    await expect(page.getByText(/Push notifications enabled/i)).toBeVisible();

    // Should save subscription to database
    // ... verify database state
  });

  test('should receive push notification when comment is created', async ({ page, context }) => {
    // Enable push notifications
    // ... enable push

    // Open a new page (simulate another user)
    const page2 = await context.newPage();
    await page2.goto('http://localhost:3000');
    // ... login as different user

    // Create a comment mentioning the first user
    await page2.goto('http://localhost:3000/b/test-board?card=test-card');
    await page2.fill('textarea[placeholder*="comment"]', '@TestUser Hello!');
    await page2.click('button:has-text("Post")');

    // Simulate push notification delivery
    await simulatePushNotification(page, {
      title: 'New mention',
      body: 'User mentioned you in a comment',
      data: {
        card_id: 'test-card-id',
        notification_id: 'test-notification-id',
      },
    });

    // Verify notification was received
    await expect(page.getByText('New mention')).toBeVisible();
  });

  test('should not send push when web_push_enabled is false', async ({ page }) => {
    // Disable push in settings
    await page.click('[aria-label="Notifications"]');
    await page.click('text=Settings');
    await page.click('input[type="checkbox"][name="web_push_enabled"]');
    await page.click('button:has-text("Save")');

    // Trigger a notification
    // ... create comment/mention

    // Should not receive push notification
    // (verify by checking notification bell instead)
    await expect(page.getByText('New mention')).not.toBeVisible();
  });

  test('should not send push during quiet hours', async ({ page }) => {
    // Set quiet hours to current time
    await page.click('[aria-label="Notifications"]');
    await page.click('text=Settings');

    // Set quiet hours to include current time
    const now = new Date();
    const startHour = now.getHours();
    const endHour = (startHour + 2) % 24;

    await page.fill('input[name="quiet_hours_start"]', `${String(startHour).padStart(2, '0')}:00`);
    await page.fill('input[name="quiet_hours_end"]', `${String(endHour).padStart(2, '0')}:00`);
    await page.click('button:has-text("Save")');

    // Trigger a notification
    // ... create comment/mention

    // Should not receive push notification
    await expect(page.getByText('New mention')).not.toBeVisible();
  });

  test('should test notification with test button', async ({ page }) => {
    await page.click('[aria-label="Notifications"]');
    await page.click('text=Settings');

    // Click "Send Test Notification"
    await page.click('button:has-text("Send Test Notification")');

    // Should receive test notification
    await expect(page.getByText('Test notification')).toBeVisible({ timeout: 5000 });
  });
});
```

---

### **タスク 2: `docs/detail/notifications.md` の作成**
- [ ] ファイル作成: `docs/detail/notifications.md`

```markdown
# Notifications System

## Overview
Taesk provides two types of notifications:
1. **In-App Notifications**: Shown in the notification bell
2. **Web Push Notifications**: Browser push notifications (requires PWA on iOS)

## Architecture

### Notification Generation Flow
1. User action (e.g., comment, mention) triggers notification
2. `lib/server/notifications.ts` generates notification record
3. `notifications` table INSERT triggers database trigger
4. Database trigger invokes `send-push-notification` Edge Function
5. Edge Function sends Web Push to subscribed devices

### Data Models

#### notifications
- `id`: UUID
- `recipient_id`: UUID (references profiles)
- `type`: TEXT (comment_created, mention, etc.)
- `payload`: JSONB (message, metadata)
- `read_at`: TIMESTAMPTZ
- `dedupe_key`: TEXT (for idempotency)

#### notification_preferences
- `profile_id`: UUID (primary key)
- `in_app_enabled`: BOOLEAN (default: true)
- `web_push_enabled`: BOOLEAN (default: false)
- `quiet_hours`: JSONB ({ start, end, timezone })

#### push_subscriptions
- `id`: UUID
- `profile_id`: UUID
- `endpoint`: TEXT (unique)
- `p256dh`: TEXT
- `auth`: TEXT
- `last_sent_at`: TIMESTAMPTZ
- `failure_count`: INTEGER

#### notification_delivery_logs
- `id`: UUID
- `notification_id`: UUID
- `subscription_id`: UUID
- `status`: TEXT (success, failure, retrying)
- `error`: TEXT

## Setup

### VAPID Keys
1. Generate keys:
   ```bash
   npx web-push generate-vapid-keys
   ```

2. Add to `.env.local`:
   ```bash
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public_key>
   VAPID_PRIVATE_KEY=<private_key>
   ```

3. Add to Supabase Secrets:
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY="<public_key>"
   supabase secrets set VAPID_PRIVATE_KEY="<private_key>"
   supabase secrets set VAPID_SUBJECT="mailto:admin@taesk.app"
   ```

### Service Worker
The Service Worker is located at `public/sw.js` and handles:
- Push notification reception
- Notification click handling
- Subscription change handling

### Edge Function
Deploy the Edge Function:
```bash
supabase functions deploy send-push-notification --project-ref <project_ref>
```

## Features

### Quiet Hours
Users can set quiet hours (e.g., 22:00-07:00) to suppress notifications during sleep time.

Implementation:
- `lib/server/quiet-hours.ts` contains the logic
- Checked in `createNotification()` and `send-push-notification` Edge Function
- Uses user's timezone for accurate calculation

### Idempotency
Notifications use `dedupe_key` to prevent duplicates:
- Format: `{type}:{recipient_id}:{comment_id}:{card_id}`
- Unique constraint on `notifications.dedupe_key`

### Rate Limiting
- Max 10 push notifications per user per minute
- Enforced in Edge Function

### Failure Handling
- 410 Gone / 404 Not Found: Subscription is deleted
- 5xx errors: Retry (increment `failure_count`)
- After 5 consecutive failures: Subscription is deleted

## Troubleshooting

### Push notifications not working

#### 1. Check browser support
- **iOS**: Requires PWA installation (Add to Home Screen)
- **Desktop**: Chrome, Edge, Firefox supported
- **Android**: Chrome, Firefox supported

#### 2. Check permissions
```javascript
console.log(Notification.permission); // Should be "granted"
```

#### 3. Check Service Worker
```javascript
navigator.serviceWorker.ready.then(reg => {
  console.log('Service Worker active:', reg.active);
  reg.pushManager.getSubscription().then(sub => {
    console.log('Push subscription:', sub);
  });
});
```

#### 4. Check Edge Function logs
```bash
supabase functions logs send-push-notification --project-ref <project_ref>
```

#### 5. Check database
```sql
-- Check if notification was created
SELECT * FROM notifications WHERE recipient_id = '<user_id>' ORDER BY created_at DESC LIMIT 5;

-- Check if push subscription exists
SELECT * FROM push_subscriptions WHERE profile_id = '<user_id>';

-- Check delivery logs
SELECT * FROM notification_delivery_logs WHERE notification_id = '<notification_id>';
```

### Common Issues

#### "Failed to subscribe - no active Service Worker"
**Cause**: Service Worker not yet active
**Fix**: Wait for `navigator.serviceWorker.ready` before subscribing

#### "Push subscription failed"
**Cause**: VAPID keys not configured
**Fix**: Check `.env.local` and Supabase Secrets

#### "Notifications not showing on iOS"
**Cause**: PWA not installed
**Fix**: Add to Home Screen from Safari

#### "Quiet hours not working"
**Cause**: Timezone mismatch
**Fix**: Verify timezone in `notification_preferences.quiet_hours.timezone`

## Testing

### Manual Testing
1. Enable push notifications in settings
2. Create a comment mentioning yourself from another account
3. Verify push notification is received

### E2E Testing
Run Web Push E2E tests:
```bash
npx playwright test e2e/phase3-webpush.spec.ts
```

### Test Notification
Use the "Send Test Notification" button in settings to verify push delivery.

## References
- [Web Push Protocol (RFC 8030)](https://datatracker.ietf.org/doc/html/rfc8030)
- [VAPID (RFC 8292)](https://datatracker.ietf.org/doc/html/rfc8292)
- [Push API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [Service Worker API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
```

---

### **タスク 3: `docs/releases/` の作成**
- [ ] ディレクトリ作成: `docs/releases/`
- [ ] ファイル作成: `docs/releases/2025-10-phase3-comments-notifications.md`

```markdown
# Phase 3: Comments & Notifications Release

**Release Date**: 2025-10-22
**Version**: Phase 3

## 🎉 Highlights

### 1. **Comments System**
- Add, edit, delete comments on cards
- Threaded replies
- Real-time updates via Supabase Realtime
- Offline support with sync queue

### 2. **@Mentions**
- Type `@` to search and mention team members
- UUID-based mentions for accurate notifications
- Hover to see member profile
- Server-side validation

### 3. **In-App Notifications**
- Real-time notification bell
- Unread badge
- "Mark all as read" functionality
- Notification types: comment, reply, mention

### 4. **Web Push Notifications**
- Browser push notifications for comments and mentions
- iOS PWA support
- Quiet hours to suppress notifications during sleep
- Per-user settings (In-App / Push toggle)

### 5. **Notification Settings**
- Enable/disable In-App and Push notifications
- Set quiet hours with timezone support
- Test notification button

## 📊 Statistics

- **New Tables**: 4 (`comments`, `notifications`, `notification_preferences`, `notification_delivery_logs`)
- **New API Routes**: 8
- **New Components**: 7
- **E2E Tests**: 15 (comments) + 5 (webpush) = 20 tests
- **Lines of Code**: ~2,500

## 🚀 Rollout Plan

### Phase 1: Internal Testing (Week 1)
- [ ] Deploy to staging environment
- [ ] Test with internal team
- [ ] Verify push notifications on iOS/Android/Desktop
- [ ] Monitor Edge Function logs for errors

### Phase 2: Beta Release (Week 2)
- [ ] Enable for 10% of users (feature flag)
- [ ] Collect feedback
- [ ] Monitor performance metrics
- [ ] Fix critical bugs

### Phase 3: Full Rollout (Week 3)
- [ ] Enable for 100% of users
- [ ] Announce in changelog
- [ ] Update user documentation

## 🔧 Setup Requirements

### For Developers
1. Generate VAPID keys
2. Update `.env.local` with VAPID keys
3. Deploy Edge Function
4. Run migrations

### For Production
1. Set Supabase Secrets (VAPID keys)
2. Deploy Edge Function
3. Run database migrations
4. Enable feature flags

## ⚠️ Known Issues & Limitations

### iOS Limitations
- **Requires PWA installation**: Web Push only works after "Add to Home Screen"
- **No push when app is in foreground**: iOS limitation
- **No custom notification sounds**: iOS PWA limitation

### Desktop Limitations
- **Firefox private mode**: Push notifications disabled in private mode
- **Safari <16.4**: Web Push not supported on older Safari versions

### Performance Considerations
- **Rate limiting**: Max 10 push notifications per user per minute
- **Quiet hours**: Notifications suppressed during configured hours
- **Subscription cleanup**: Invalid subscriptions auto-deleted after 5 failures

## 🐛 Bug Fixes Since Phase 2
- Fixed Service Worker cache errors for icon files
- Fixed VAPID key configuration issues
- Fixed Service Worker activation timing
- Fixed notification deduplication

## 📚 Documentation Updates
- Added `docs/detail/notifications.md`
- Updated `docs/detail/architecture.md` with notification flow
- Updated `docs/detail/testing.md` with E2E test coverage
- Updated `docs/setup/local-dev.md` with Service Worker setup

## 🙏 Acknowledgments
Thanks to the team for implementing and testing this major feature!

## 📞 Support
For issues or questions, please check:
- `docs/detail/notifications.md` (Troubleshooting section)
- GitHub Issues
- Internal Slack #taesk-support
```

---

### **タスク 4: `docs/setup/local-dev.md` の更新**
- [ ] ファイル読み込み: `docs/setup/local-dev.md` (存在確認)
- [ ] なければ作成、あれば追記

以下のセクションを追加:

```markdown
## Service Worker & Web Push Setup

### 1. Generate VAPID Keys
```bash
npx web-push generate-vapid-keys
```

### 2. Update `.env.local`
Add the generated keys:
```bash
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<your_public_key>
VAPID_PRIVATE_KEY=<your_private_key>
```

### 3. Start Development Server
```bash
npm run dev
```

### 4. Register Service Worker
- Navigate to `http://localhost:3000`
- Service Worker will automatically register at `/sw.js`
- Check registration in DevTools → Application → Service Workers

### 5. Test Push Notifications

#### Option A: Using Test Button
1. Click notification bell → Settings
2. Click "Enable Push Notifications"
3. Click "Send Test Notification"

#### Option B: Manual Testing
1. Create two browser windows (different users)
2. User A creates a comment mentioning User B
3. User B should receive push notification

### 6. Edge Function Local Development

#### Start Supabase locally
```bash
supabase start
```

#### Serve Edge Function
```bash
supabase functions serve send-push-notification --env-file .env.local
```

#### Set database config
```sql
ALTER DATABASE postgres SET app.supabase_url = 'http://localhost:54321';
```

#### Test Edge Function
```bash
curl -X POST http://localhost:54321/functions/v1/send-push-notification \
  -H "Content-Type: application/json" \
  -d '{"notification_id":"test-id","recipient_id":"user-id","type":"test","payload":{"message":"Test"}}'
```

### Troubleshooting

#### Service Worker not updating
- Increment `SW_VERSION` in `public/sw.js`
- Hard refresh (Cmd+Shift+R / Ctrl+Shift+F5)
- Unregister old SW in DevTools

#### Push subscription failing
- Check `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is set correctly
- Verify Service Worker is active (`navigator.serviceWorker.ready`)
- Check browser console for errors

#### Database trigger not firing
- Verify `app.supabase_url` is set:
  ```sql
  SHOW app.supabase_url;
  ```
- Check Supabase logs:
  ```bash
  supabase functions logs send-push-notification
  ```
```

---

### **タスク 5: CI での E2E テスト実行**
- [ ] `.github/workflows/playwright.yml` を確認・更新
- [ ] Web Push モックが CI で動作することを確認

---

## ✅ 受け入れ基準
- [ ] `e2e/phase3-webpush.spec.ts` が作成され、5つ以上のテストケースがある
- [ ] Web Push モック (`e2e/utils/push.ts`) が実装されている
- [ ] `docs/detail/notifications.md` が作成され、フロー・設定・トラブルシュートが記載されている
- [ ] `docs/releases/2025-10-phase3-comments-notifications.md` が作成されている
- [ ] `docs/setup/local-dev.md` に Service Worker 設定手順が追記されている
- [ ] Playwright テストが CI で安定して通過する

---

## 🧪 テスト
```bash
# Run Web Push E2E tests
npx playwright test e2e/phase3-webpush.spec.ts --reporter=json > playwright-report-webpush.json
cat playwright-report-webpush.json | jq '.stats'

# Run all Phase 3 tests
npx playwright test e2e/phase3-*.spec.ts
```

---

## 📎 依存関係
- 前提: 0302 (Web Push送信) 完了
- 前提: 0303 (通知設定) 完了

---

## ❓ オープン課題
- iOS デバイスでの自動E2Eテスト (現状は手動検証のみ)
- Web Push モックの flakiness (Service Worker タイミング問題)

---

## 📊 工数見積
- **見積**: 1-2時間
  - Web Push E2E テスト: 0.5-1時間
  - ドキュメント作成: 0.5-1時間

---

## 📝 メモ
- 0209 チケットで「100% 完了」と主張されていたが、実際には Web Push 関連が未実装だった
- 本チケットで真の意味での「完了」を達成する
