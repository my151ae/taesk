# 0204 通知生成ルール（コメント/メンション）

**作成日**: 2025-10-20
**関連エピック**: `docs/tickets/2025-10-20/0200-comments-notifications-epic.md`
**担当候補**: BE（API/サービス実装）

---

## 🎯 ゴール
- コメント・返信・メンション発生時に適切な通知（In-App/Web Push 下準備）を生成するサーバーロジックを実装する
- 冪等性と権限チェックを備え、重複通知や不正アクセスを防止する
- 将来の通知チャネル追加（メール・期限リマインダー）に耐えられるサービス構造を整える

## 📝 背景
- 既存の `/api/notifications` は手動POSTのみ、コメント操作と連動していない
- コメントイベントは複数の対象者（作成者・アサイニー・参加者・@メンション）に通知する必要がある
- 今後 Web Push 送信（0207）を行う際、同じ通知生成ロジックを再利用する想定

## ✅ スコープ
- 通知生成サービス（`lib/server/notifications.ts` 等）を新設し、イベント駆動で呼び出す
- コメント作成/返信/編集 API からサービスを呼び出し、通知レコードを upsert
- 冪等キー（`comment_id + recipient_id + event_type`）で重複登録を防止
- 通知 payload にはカード/コメント情報、メンション対象、ボードURLなどを含める
- In-App 未読バッジ向けに `notifications` Realtime チャンネルへブロードキャスト

## 🚫 非スコープ
- Web Push 実送信（0207）
- 通知の UI 側更新（0205）
- 期限リマインダーなどコメント以外のイベント（別チケットで拡張）

## 📦 実装タスク
1. **通知サービス設計**
   - `createNotification(event: CommentNotificationEvent)` の API を定義
   - Event payload: `{ event: 'comment_created' | 'comment_replied' | 'comment_mentioned', commentId, cardId, boardId, senderId, recipientIds[] }`
   - 通知本文テンプレート（`payload.message`）をローカライズ前提で組み立て
2. **対象者解決**
   - カード作成者、`assignee_id`, コメントスレッド参加者、@メンションの受信者をユーティリティで抽出
   - 自分自身への通知は除外
3. **冪等処理**
   - `notifications` テーブルに `dedupe_key` (text) を追加するか、`insert ... on conflict` で `recipient_id + type + payload->>'comment_id'` をユニーク扱いにする
   - 重複時は既存レコードを更新（`created_at` は保持、`payload.message` を差し替え）
4. **API 統合**
   - `/api/cards/[cardId]/comments` の POST/DELETE/ PATCH 完了後に通知サービスを呼び出し
   - エラー時はトランザクションをロールバックし、HTTP 500 を返す
   - 非同期キュー（Supabase Edge Functions Queue）が必要な場合に備え、フックポイントを用意
5. **Realtime 連携**
   - 通知作成後、`supabase.channel('notifications:recipient_id=...')` に `broadcast` する処理を追加
   - FE からは `notifications` テーブル購読のみに統一する前提で設計

## ✅ 受け入れ基準
- [ ] コメント/返信/メンション発生時に対象ユーザーの `notifications` にレコードが1件ずつ作成される
- [ ] 同じコメントに対して複数回編集/再送しても通知が重複しない（`dedupe_key` が機能する）
- [ ] 権限外ユーザーがコメント操作を行った場合、通知は生成されない
- [ ] Realtime 経由で通知が配信され、FE の未読件数が即座に更新される

## 🧪 テスト
- [ ] `npm run lint`
- [ ] サービス単体テスト（`lib/server/__tests__/notifications.test.ts`）で対象者抽出や冪等性を検証
- [ ] `npx playwright test e2e/phase3-notifications.spec.ts --reporter=json > playwright-report-notifications.json`
  - [ ] `cat playwright-report-notifications.json | jq '.stats'`
- [ ] Supabase ローカル環境でコメント→通知生成フローを手動確認

## 📎 依存関係
- 前提: 0201（DB整備）、0202（UI統合）、0203（メンションUUID化）
- 後続: 0205（UI 表示強化）、0206/0207（Push 周辺）

## ❓ オープン課題
- 通知テンプレートの多言語対応タイミング
- コメント削除時に通知をどう扱うか（履歴保持 vs 取り消し）

