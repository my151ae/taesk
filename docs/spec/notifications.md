# Notifications Overview

This document describes how Taesk creates, stores, and delivers notifications across the product. Timeline ボードのヘッダーには `NotificationsBell` と `NotificationSettings` が常設されており、旧 Kanban と同じ通知機構を継承している。

## Notification Types

- **In-app notifications** – persisted in the `notifications` table and surfaced inside the UI.
- **Web Push notifications** – delivered through the browser when users opt in.

Both channels share the same creation pipeline but respect user preferences individually.

## Data Flow

1. **Event triggers** (e.g., a comment or mention) call `createNotification` in `lib/server/notifications.ts`.
2. The helper reads `notification_preferences` for the recipient:
   - `in_app_enabled` – skip notification entirely when `false`.
   - `quiet_hours` – suppress notifications during the configured window.
3. A dedupe key prevents duplicate rows for the same event.
4. Successful inserts into `notifications` fire the Supabase trigger defined in `20251022000001_notification_push_trigger.sql`.
5. The trigger invokes the Edge Function `supabase/functions/send-push-notification/index.ts` which:
   - Loads preferences again to honour `web_push_enabled` and quiet hours.
   - Applies a per-subscription rate limit (default 10 per minute).
   - Logs delivery attempts in `notification_delivery_logs`.
   - Removes failing subscriptions after repeated errors.

## Notification Preferences

The `notification_preferences` table stores per-user settings:

| Column | Type | Notes |
| --- | --- | --- |
| `profile_id` | UUID PK | matches `profiles.id` |
| `in_app_enabled` | boolean (default `true`) | disable all in-app notifications |
| `web_push_enabled` | boolean (default `false`) | whether push delivery is allowed |
| `quiet_hours` | JSONB or `null` | `{ "start": "HH:mm", "end": "HH:mm", "timezone": "IANA" }` |
| `created_at` / `updated_at` | timestamptz | maintained by trigger |

API routes:

- `GET /api/notifications/preferences` – returns the current preferences (defaults when no row exists).
- `PUT /api/notifications/preferences` – accepts partial updates (`in_app_enabled`, `web_push_enabled`, `quiet_hours`).
- `POST /api/notifications/test` – enqueues a test notification for the authenticated user.
- `POST /api/boards/[boardId]/notifications/daily-digest-test` – creates a manual daily digest preview for the authenticated board member.

Clients should treat the API as the source of truth instead of talking to Supabase directly.

## Web Push Behaviour

### Push Copy Safety Limits

- `title`: target `24`, hard max `30`
- `body`: target `36`, hard max `40`
- `daily_digest` board name: target `18`, hard max `20`
- grapheme 単位で長さを評価し、短縮時は末尾に `…` を付ける
- これらの safety limits は **push title/body** にのみ適用し、in-app 一覧の表示文面には直接適用しない

### Daily Digest Push Format

- title: `Taesk: {board_name}`
- body: `今日 {today}件 / overdue {overdue}件 - {taskTitleShort}`
- item がない場合の body は `今日 0件 / overdue 0件`
- preview API の `title/body/titleLength/bodyLength`、本番 digest payload、push payload は同じ shared helper で生成する

### Daily Digest Manual Test

- `NotificationSettings` の board context でのみ `Send Daily Digest Test` を表示する
- manual test は `type='daily_digest'` の notification row を即時作成し、現在の board 状態から preview 用 digest を組み立てる
- manual test は見た目確認用なので `enabled`, `delivery_time`, `last_sent_local_date`, `in_app_enabled`, `quiet_hours` を送信可否条件に使わない
- `last_sent_local_date` は更新しない
- `manual_test: true` を payload に含め、push 配信時は **daily digest manual test のみ** quiet hours を bypass する
- `web_push_enabled=false` は bypass しない。push 不可でも in-app row は作成する
- `pushReason='enabled'` は「push を試行可能」を意味し、送達成功そのものは保証しない

The Edge Function uses the [`web-push`](https://www.npmjs.com/package/web-push) library inside Deno. Environment variables required at deployment time:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

When keys are missing the function exits early and no push is attempted (delivery log records the skip).

### Delivery Logs

`notification_delivery_logs` keeps a history for observability and rate limiting. Columns include `status` (`success`, `failure`, `retrying`), the associated notification, the subscription, and optional error text.

## Foreground Sound & Audio Unlock

Chrome / Safari の Autoplay 制限を踏まえ、Taesk では **Web Audio API** を使って「前景タブのみビープ音」を再生する。これにより OS 標準通知音（背景タブ）と競合せず、Google Chat 同様の体験を実現している。

### 構成要素

1. **`lib/notification-audio.ts`**
   - 単一の `AudioContext` を保持し、`unlockAudio()`, `playNotificationSound()`, `isAudioUnlocked()` を提供。
   - サイン波オシレーターを 800Hz で生成し、`GainNode` の指数フェード（0.3 → 0.01, 200ms）で柔らかいビープにする。
   - 旧来のデータURL(WAV) 依存を完全に排除し、ブラウザ組み込みの DSP のみで音を生成。

2. **`app/(board)/_components/NotificationSettings.tsx`**
   - 「🔊 音声を有効化」ボタン：`unlockAudio()` を強制呼び出し、ユーザー操作で AudioContext を `running` 状態へ。
   - 「🎵 テスト音を再生」ボタン：`playNotificationSound()` を直接呼び出し、ローカルでサウンド確認できるようにする。
   - 「テスト通知を送信」ボタン：`showTestNotification()`（ブラウザ通知） + `/api/notifications/test`（in-app）を実行。

3. **`app/components/NotificationSoundPlayer.tsx`**
   - Service Worker からの `postMessage({ type: 'NOTIFICATION_RECEIVED', payload })` を監視。
   - `document.visibilityState === 'visible'` かつ `isAudioUnlocked()` のときのみ `playNotificationSound()` を実行。

4. **`public/sw.js`**
   - Push イベントで `silent: false`, `renotify: true` を設定しつつ、前景タブへ `NOTIFICATION_RECEIVED` メッセージを送る。
   - 背景タブではブラウザ/OS 標準の通知音に委ね、Web Audio は呼ばない。

### テスト手順

1. Playwright 実行後（JSON レポート出力済みであること）に chrome-devtools MCP を使ってアプリを開き、`NotificationSettings` セクションへ移動。
2. **「音声を有効化」** → ブラウザコンソールに `[Audio] Audio unlocked successfully` が出力されることを確認。
3. **「🎵 テスト音を再生」** → 800Hz / 200ms フェードのビープが鳴り、`[Audio] Notification sound played` がログに残ること。
4. **「テスト通知を送信」** → 前景タブでは Web Audio ビープ、背景タブでは OS 標準通知音のみ鳴ることを確認。Service Worker ログ（`[SW] Push event received` など）も併せて確認する。

## Quiet Hours Logic

- Quiet hours compares the current time in the user’s timezone against the configured window.
- Overnight ranges (e.g., 22:00 → 07:00) are supported by wrapping across midnight.
- Quiet hours apply to both in-app creation (notifications can be skipped completely) and push delivery. Currently skipped notifications are not requeued.

## Related Components

- **UI:** `app/(board)/_components/NotificationSettings.tsx`
- **Server helpers:** `lib/server/notifications.ts`
- **Edge Function:** `supabase/functions/send-push-notification/index.ts`
- **Foreground sound:** `app/components/NotificationSoundPlayer.tsx`, `lib/notification-audio.ts`
- **Playwright E2E:** `e2e/notifications.spec.ts`

Playwright での検証とローカルセットアップは `docs/spec/local-dev.md` を参照。Timeline では通知トリガー用の UI（テスト通知、音声テスト）がヘッダーに統合されている。

## Badge Sync & Favicon Fallback

- **`lib/badge.ts`** – App Badging API のラッパー。PWA / Safari Web アプリで `navigator.setAppBadge` / `clearAppBadge` を安全に呼び出す。
- **`lib/favicon-badge.ts`** – Canvas で既存 favicon を再描画し赤丸を重ねるフォールバック。App Badging 非対応ブラウザでも未読数を示せる。
- **`lib/unified-badge.ts`** – 上記をまとめた `setUnifiedBadge(count)` を提供。App Badging が成功した場合は favicon 書き換えをスキップし、失敗時のみ fallback を実行。タイトルも `(12) Taesk` のように更新する。
- **`app/components/NotificationBadgeListener.tsx`** – `useNotificationsStore` の `unreadCount` を購読しつつ、Service Worker からの `NOTIFICATION_RECEIVED` をリッスンして暫定バッジを更新。`visibilitychange` / `focus` でカウントを再同期し、前景に戻った瞬間に不要な赤丸を消す。

挙動メモ:

1. 通知を受信した直後は `NotificationBadgeListener` が pending バッジを +1 し、ストア同期前でも favicon / タイトルが即更新される。
2. `useNotificationsStore` が Supabase Realtime / Polling で最新未読を取得すると `setUnifiedBadge(unreadCount)` が再実行され、実数値に揃う。
3. App Badging がサポートされない Linux / Firefox などでは favicon のみが差し替わる。Service Worker から DOM を触れないため、**アプリが完全に閉じている場合は更新不可**。
4. Web アプリ（Safari ホーム画面 / Dock, Chrome/Edge PWA）では OS バッジが優先されるため favicon 更新はスキップされる。
5. 通常のブラウザタブ（Chrome, Edge など）では App Badging API が存在しても standalone モードではない限り favicon バッジを必ず描画し、Google Chat と同じ赤丸表示を再現する。

開発時は `window.dispatchEvent(new CustomEvent('taesk:notification-received'))` で擬似通知を発火し、favicon が赤丸に変わること、タイトルが `(99+) Taesk - Timeline Board` になることを確認する。
