# 0206 Push購読 & Service Worker 実装

**作成日**: 2025-10-20
**関連エピック**: `docs/tickets/2025-10-20/0200-comments-notifications-epic.md`
**担当候補**: FE（PWA） + BE（API）

---

## 🎯 ゴール
- Web Push 配信の前提として、Service Worker と Push 購読管理（subscribe/unsubscribe）を実装する
- ユーザーが明示的に通知許可を与え、購読情報を Supabase の `push_subscriptions` に安全に保存できる
- iOS PWA の要件を満たし、オフライン時にも Service Worker が正常に動作する

## 📝 背景
- `push_subscriptions` テーブルは既に存在するが、クライアント側で購読を取得/更新する処理が未実装
- Web Push 権限はユーザー操作を契機に要求する必要があり、導線設計が必須
- Service Worker は今後のオフラインキャッシュ/背景同期にも活用する基盤となる

## ✅ スコープ
- `public/sw.js` を作成し、`push`/`notificationclick`/`pushsubscriptionchange` ハンドラを実装
- Next.js クライアントで Service Worker を登録し、購読UI（設定メニュー or 通知ベル）を追加
- `/api/push-subscriptions` API Route（POST/DELETE）を実装して購読情報を永続化
- VAPID 公開鍵をクライアントに渡す仕組み（`NEXT_PUBLIC_WEBPUSH_PUBLIC_KEY`）
- 購読更新（`pushsubscriptionchange`）時の自動再登録

## 🚫 非スコープ
- 実際の Push メッセージ送信（0207）
- Quiet hours などの設定 UI（0208）
- iOS 向けインストールガイド（0208）

## 📦 実装タスク
1. **Service Worker 雛形**
   - `push` イベントで `event.data.json()` → `self.registration.showNotification`
   - `notificationclick` で該当カードURLに遷移（クエリで `card_short_id` 等）
   - `pushsubscriptionchange` で再購読を試み、API へ PATCH
2. **クライアント登録**
   - `app/(board)/_components/NotificationsBell.tsx` または設定画面で `navigator.serviceWorker.register('/sw.js')`
   - 許可ボタン押下で `Notification.requestPermission`
   - `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`
3. **API Route 実装**
   - `POST /api/push-subscriptions` で購読情報を upsert（`endpoint` ユニーク）
   - `DELETE /api/push-subscriptions` で購読解除
   - RLS: 自分の購読のみ操作可能
4. **iOS 対応**
   - `beforeinstallprompt` ハンドリング、A2HS ガイド導線（0208 と連携）
   - iOS Safari の `navigator.standalone` チェック→非対応時は Web Push 許可ボタンを無効化
5. **ロギング/エラーハンドリング**
   - サブスク失敗時にユーザーへトースト表示
   - `pushsubscriptionchange` が連続失敗する場合の再試行ポリシーを定義

## ✅ 受け入れ基準
- [ ] Service Worker が本番/ローカルで登録され、`navigator.serviceWorker` 経由で確認できる
- [ ] 許可ボタン押下で通知許可を要求し、許可時に購読が `push_subscriptions` に保存される
- [ ] 購読解除ボタンで Supabase から endpoint が削除される
- [ ] iOS Safari（PWAインストール済み）の場合のみ許可ボタンが有効化される
- [ ] Service Worker が Push イベントを受け取って `showNotification` を呼び出せる（0207 のモックメッセージで確認）

## 🧪 テスト
- [ ] `npm run lint`
- [ ] `npx playwright test e2e/phase3-notifications.spec.ts --grep "@push-subscription" --reporter=json > playwright-report-push-subscription.json`
  - [ ] `sed -n '/^{/,$p' playwright-report-push-subscription.json | jq '.stats'`
- [ ] Web Push テストツール（`npx web-push send-notification ...` のモック）で受信確認
- [ ] iOS PWA 実機/シミュレータ検証（手動）

## 📎 依存関係
- 前提: 0205 までに通知 UI が整備されていると導線が作りやすい
- 後続: 0207（Push送信実装）、0208（設定UI）

## ❓ オープン課題
- `public/sw.js` のキャッシュ戦略（更新検知のための versioning）
- マルチテナント環境での VAPID Key 管理
