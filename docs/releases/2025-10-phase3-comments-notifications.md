# Release Notes – October 2025: Comments & Notifications (Timeline-ready)

## Highlights

- Timeline ヘッダーに `NotificationSettings` / `NotificationsBell` を統合。Kanban 用 UI を廃止し、Today/Tomorrow ビューから直接通知設定にアクセスできる。
- Web Push delivery が end-to-end で稼働。VAPID 認証、Edge Function (`supabase/functions/send-push-notification`) の rate limiting、`notification_delivery_logs` による観測が実装済み。
- Notification Preferences モーダルが in-app / push トグル、quiet hours（Timezone 対応）、foreground audio アンロック、テスト音/テスト通知ボタンを提供。
- Playwright `e2e/notifications.spec.ts` が Timeline UI での通知体験（音声アンロック、quiet hours、テスト通知）を JSON レポート付きで検証。

## Setup Checklist

1. `npx web-push generate-vapid-keys` で VAPID キーを発行し、`.env.local` / `.env.test` と Supabase secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) に設定。
2. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` を Vercel (Production/Preview) とローカル環境ファイルに追加。
3. Supabase マイグレーションを `20251022000004_notification_preferences.sql` まで適用。
4. `docs/setup/local-dev.md` の手順に従い、Timeline 上で NotificationSettings が表示されることを確認。
5. `npm run test:notifications`（または `npm run test:all-split`）を実行し、`test-results/batches/*-notifications.json` の統計を `docs/tickets/` に記録。

## Known Issues

- Quiet hours は現在スキップのみ。後続タスクで再送キューを導入予定。
- Playwright では Web Push をモックしているため、実際のブラウザ通知は Supabase ログとブラウザを併用して確認する必要がある。
- iOS Safari など Push 非対応環境では NotificationSettings の一部 UI を自動で無効化するが、モバイルの挙動は別途手動検証が必要。

## Links

- Feature docs: `docs/detail/notifications.md`
- Local setup: `docs/setup/local-dev.md`
- Related tickets: `docs/tickets/2025-10-22/0302-*`, `0303-*`, `0304-*`
