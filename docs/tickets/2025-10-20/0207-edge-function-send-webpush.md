# 0207 Web Push 送信 Edge Function

**作成日**: 2025-10-20
**関連エピック**: `docs/tickets/2025-10-20/0200-comments-notifications-epic.md`
**担当候補**: BE（Deno/Edge Functions）

---

## 🎯 ゴール
- Supabase Edge Function もしくは API Route で Web Push 通知を送信できるようにし、コメント通知（0204）と連携する
- VAPID 鍵管理、レート制御、エラーハンドリングを実装し、安定した配信を実現する
- 将来のバッチ配信や他イベント通知にも再利用可能な構造を準備する

## 📝 背景
- Web Push を送るにはサーバー側で VAPID 署名付きのリクエストを購読 endpoint に送る必要がある
- Supabase Edge Functions (Deno) を利用して、アプリケーションサーバーから分離した配信レイヤーを構築したい
- 失敗時（410 Gone 等）の購読クリーンアップやリトライも考慮する必要がある

## ✅ スコープ
- `supabase/functions/send-webpush/index.ts`（仮）に Edge Function を実装
- `web-push` 互換の Deno ライブラリ（`https://deno.land/x/webpush` 等）を利用して Push 送信
- `notifications` レコードを参照し、対象ユーザーの `push_subscriptions` を取得→メッセージ送信
- 送信結果を Supabase `notification_delivery_logs`（新設テーブル）に保存し、エラー処理を行う
- VAPID 鍵の Secrets 管理 (`SUPABASE_EDGE_FUNCTION_WEBPUSH_PUBLIC/PRIVATE_KEY`)

## 🚫 非スコープ
- Edge Function 呼び出しをトリガーするスケジューラ（cron）
- メール通知など他チャネル

## 📦 実装タスク
1. **テーブル/設定準備**
   - `notification_delivery_logs(id, notification_id, subscription_id, status, error, created_at)` テーブル追加
   - `push_subscriptions` に `last_sent_at`/`failure_count` を追加（連続失敗で購読解除）
2. **Edge Function 実装**
   - エントリポイント: POST ボディ `{ notificationId: string }`
   - `notifications` テーブルから payload を取得し、対象ユーザーの購読一覧をフェッチ
   - 各購読に対して `sendWebPush(subscription, payload)` を実行
   - 成功/失敗に応じて `notification_delivery_logs` と `push_subscriptions.failure_count` を更新
3. **冪等性・レート制御**
   - 同じ通知を複数回送らないように `notification_delivery_logs` を参照
   - 1ユーザーあたり/1分に送信上限を設定（設定値は `.env` に）
4. **API 連携**
   - 0204 の通知生成後、Push 対象が存在すれば Edge Function を呼び出し（Supabase Client `invoke`）
   - 非同期処理とし、失敗時はログのみ（UI には影響なし）
5. **監視/ロギング**
   - Supabase Function Logs を Cloud Logging に連携
   - 重大エラー時には Slack Webhook（既存運用があれば）を叩くフックを用意

## ✅ 受け入れ基準
- [ ] Edge Function を手動呼び出しすると、プッシュ購読済みのブラウザで通知を受信できる
- [ ] 購読が無効（410 Gone）になった場合、自動的に `push_subscriptions` から削除される
- [ ] 同一通知が複数回送信されない（`notification_delivery_logs` で確認）
- [ ] レート制御が働き、過剰送信がブロックされる

## 🧪 テスト
- [ ] `npm run lint`（Edge Function TypeScript の ESLint 対応）
- [ ] Edge Function のユニットテスト（Deno test）
- [ ] `npx playwright test e2e/phase3-notifications.spec.ts --grep "@webpush" --reporter=json > playwright-report-webpush.json`
  - [ ] `sed -n '/^{/,$p' playwright-report-webpush.json | jq '.stats'`
- [ ] ステージング環境で実際に Push 受信テストを実施

## 📎 依存関係
- 前提: 0206（Push 購読）完了、0204（通知生成）から notificationId を受け取れる
- 後続: 0208（設定UX）、0209（ドキュメント）

## ❓ オープン課題
- バッチ配信（大量通知）時のキュー管理（Supabase Queue / 外部MQ）
- VAPID 鍵ローテーション手順

