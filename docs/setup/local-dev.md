# Local Testing – Notifications & Web Push (Timeline)

Timeline ボードで通知機能を検証する際のセットアップ手順です。**手動で `npm run dev` を実行することは禁止**のため、Playwright や既存の Web サーバー（Vercel Preview など）を利用して動作確認します。

## 1. 前提条件

- `.env.local` / `.env.test` に Supabase URL/Key、Service Role Key（Playwright 用）を設定済み
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` を取得済み（なければ `npx web-push generate-vapid-keys` で生成）
- ブラウザで通知を許可できるドメインを使用（Vercel Preview もしくは Playwright が起動する `http://localhost:3000`）
- Chrome DevTools MCP または Playwright から JSON レポートとログを取得する環境

## 2. 環境変数

`.env.local` または Vercel の環境変数に以下を追加します。

```bash
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<publicKey>
VAPID_PRIVATE_KEY=<privateKey>
VAPID_SUBJECT=mailto:your-email@example.com
```

Playwright 実行時は `.env.test` が自動読込されるため、同じキーを記載してください。

## 3. 実行方法

### Playwright (`npm run test:notifications`)

```bash
# JSON レポートを test-results/ 配下に保存
PLAYWRIGHT_JSON_OUTPUT_NAME=batches/$(date +%Y%m%d-%H%M%S)-notifications.json \ 
  PW_WORKERS=1 \
  npx playwright test e2e/notifications.spec.ts --project=core --reporter=json
```

- Playwright が `webServer.command`（`NODE_ENV=test npm run dev`）を起動するため、事前にポート 3000 を空けておく。
- テスト成功後、`test-results/batches/...-notifications.json` と `test-results/logs/batch-execution-*.log` を確認し、`docs/tickets/<date>` に記録する。

### 手動確認（DevTools MCP 経由）

1. 既に起動しているアプリ（Vercel Preview など）へアクセスし、Timeline ヘッダーの `NotificationSettings` を開く。
2. **「音声を有効化」** → `[Audio] Audio unlocked successfully` がコンソールへ出力される。
3. **「🎵 テスト音を再生」** → 800Hz / 200ms フェードのビープ音を確認。
4. **「ブラウザ通知を有効化」** を押しブラウザの Permission Prompt を許可。
5. **「テスト通知を送信」** → 前景タブでは Web Audio ビープ、背景タブでは OS 標準通知音のみ鳴ることを Chrome DevTools のログ（`[SW] Push event received` など）で確認。

> DevTools で検証する場合も `npm run dev` を直接叩かず、Playwright or 本番同等環境を利用してください。

## 4. Supabase で確認する項目

- `notification_preferences`: `in_app_enabled`, `web_push_enabled`, `quiet_hours` が更新されているか
- `push_subscriptions`: ブラウザごとの endpoint / keys が登録されているか
- `notifications`: テスト通知が作成されているか（`recipient_id` が正しいか）
- `notification_delivery_logs`: Edge Function からの配信結果 (`success`, `failure`, `retrying`)

## 5. Quiet Hours / Timezone テスト

1. Timeline ヘッダーの NotificationSettings で Quiet hours を設定（例: Start 22:00, End 07:00, Timezone Asia/Tokyo）。
2. Playwright から `await page.getByRole('button', { name: 'Send Test Notification' }).click()` を実行し、quiet hours 内では通知が作成されないことを確認。
3. `notification_delivery_logs` に `quiet_hours` スキップが記録されているかを Supabase でチェック。

## 6. トラブルシューティング

| 事象 | 対処 |
| --- | --- |
| `Missing VAPID keys` ログ | `.env.local` / `.env.test` / Vercel 環境に VAPID キーを設定し、Edge Function を再デプロイ。 |
| ブラウザ通知が届かない | HTTPS ドメインで実行しているか確認（ローカルは `localhost` のみ許可）。また quiet hours や `web_push_enabled=false` を見直す。 |
| `Unexpected end of JSON input` in notifications spec | Playwright 側の Flaky。再実行して JSON レポートを `docs/tickets/` に貼り、原因解析を続ける。 |

## 7. 参考資料

- `docs/detail/notifications.md` – 通知パイプライン全体
- `docs/detail/storage.md` – `comment-queue` / `taesk-sync-queue` の挙動
- `docs/detail/testing.md` – Playwright 実行ポリシー
- `docs/tickets/2025-11-10/01-test-all-split-summary.md` – 通知バッチの最新ログ

この手順に従うことで、Timeline ボード上の通知・音声・Web Push を JSON レポート付きで検証できます。
