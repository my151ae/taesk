# Notifications 現状分析 (2026-02-03)

## 目的
通知設定／PWA 通知／バッジ挙動が「今どうなっているか」をコードベースから整理する。

---

## 現状まとめ (結論)
- **Notifications ドロワー/集約**は稼働している構成。
- **PWA Push / バッジ / 通知音**はフロー一式が存在。
- **「開始時間に合わせた通知」**に相当するスケジューラ／ジョブ／トリガーは見当たらない。
- **カード単位の通知設定**は DB/ UI ともに未実装。
- **Push は通知フラグに加えて `NEXT_PUBLIC_FF_PUSH` でも抑止され得る**ため、運用時は両方の確認が必要。

---

## 通知の全体フロー
### 1) 作成 (in-app 通知)
- コメント投稿時に通知が生成される。
- 生成関数: `lib/server/notifications.ts` (createNotification / createCommentNotifications)
- 起点: `app/api/cards/[cardId]/comments/route.ts`
- `createNotification` 内で **in-app 無効**または **quiet hours 中**の場合は作成が抑止される。

### 2) 集約 (Notifications ドロワー)
- ヘッダーベルが `/api/notifications` を取得し一覧表示。
- Realtime と Polling の併用で更新。
- UI/Store:
  - `app/(board)/_components/NotificationsBell.tsx`
  - `app/(board)/_stores/notifications-store.ts`
- API:
  - `app/api/notifications/route.ts`
  - `app/api/notifications/[notificationId]/route.ts`
  - `app/api/notifications/mark-all-read/route.ts`

### 3) Push 配信 (PWA)
- `notifications` insert → DB trigger → Edge Function → web-push
- トリガー:
  - 最新: `supabase/migrations/20251024120000_notification_push_trigger.sql`
  - 旧版: `supabase/migrations/20251022000001_notification_push_trigger.sql`
- Edge Function:
  - `supabase/functions/send-push-notification/index.ts`

### 4) 通知音 (前景のみ)
- Service Worker から `postMessage` を受け、前景かつ音声 unlock 済みならビープ再生。
- `app/components/NotificationSoundPlayer.tsx`
- `lib/notification-audio.ts`

### 5) バッジ (PWA / Favicon)
- 未読数に応じて OS バッジ or favicon バッジ。
- `app/components/NotificationBadgeListener.tsx`
- `lib/unified-badge.ts`, `lib/badge.ts`, `lib/favicon-badge.ts`
- Service Worker (Push 受信時) の簡易バッジ更新:
  - `public/sw.js`

---

## 機能別の生存状況
### Notifications ドロワー
- 集約表示は実装済み。
- 未読/全件タブあり。
- リアルタイム + ポーリングで更新。

### PWA Push
- Edge Function + DB Trigger あり。
- VAPID キー必須。
- `notification_preferences.web_push_enabled` が true の時のみ配信。

### バッジ
- store の unreadCount を基準に統合バッジ更新。
- Standalone (PWA) は OS バッジ優先、通常タブは favicon。

### 通知音
- 前景のみ Web Audio でビープ。
- 初回ユーザー操作で AudioContext unlock。

---

## 現状の不足 (要件とのギャップ)
### 「開始時間に合わせた通知」
- スケジューラ／ジョブ／Edge Scheduled Function の実装が見当たらない。
- `NotificationType` に `due_soon` は存在するが、生成処理が無い。
- 結果として **開始時間起点の通知は現在は動かない**。

### 「カード単位の通知設定」
- テーブル／API／UI が未実装。
- 現行は **ユーザー単位の通知設定のみ**。

---

## 止まりやすいポイント
- `NEXT_PUBLIC_FF_NOTIFICATIONS` が `true` でないと UI / Realtime / Polling が無効。
  - `lib/featureFlags.ts`
- `NEXT_PUBLIC_FF_PUSH` が `true` でないと Push 周りが無効になり得る。
  - `lib/featureFlags.ts`
- Supabase Realtime で `notifications` が publish されていないと Realtime 更新が来ない。
  - `supabase/migrations/20251024000000_enable_notifications_realtime.sql`
- Push トリガーは旧版と最新版があるため、DB 適用順が崩れると Edge Function が呼ばれない可能性。
  - 旧: `20251022000001_notification_push_trigger.sql`
  - 新: `20251024120000_notification_push_trigger.sql`
 - `notification_preferences` によって **in-app / quiet hours 抑止**が働くため、通知が作られないケースがある。
   - `lib/server/notifications.ts`

---

## 次の検証候補
- Playwright: `e2e/notifications.spec.ts`
- 手動: NotificationSettings のテスト通知 / Push / 音声 unlock
- 追加確認: `due_soon` を作るスケジューラの有無（cron / schedule / queue / reminder など）

---

## 参考ファイル (主要)
- `app/(board)/_components/NotificationsBell.tsx`
- `app/(board)/_components/NotificationSettings.tsx`
- `app/(board)/_stores/notifications-store.ts`
- `app/api/notifications/*`
- `lib/server/notifications.ts`
- `lib/push-notifications.ts`
- `public/sw.js`
- `supabase/functions/send-push-notification/index.ts`
- `supabase/migrations/20251024120000_notification_push_trigger.sql`
