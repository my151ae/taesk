# Phase 2: 権限/秘密情報の設計統一

## 目標
- 管理者判定と service-role 利用方針を一本化する。
- RLS と API ガードの責務分担を明文化する。

## タスク分解
1. 管理者判定の統一
- [x] `lib/admins.ts` の固定メール判定を廃止
- [x] `ADMIN_USER_IDS` のみで判定する実装へ移行
- [ ] 管理者の設定手順を `docs/` に追加

2. service-role 利用箇所の棚卸し
- [x] `createServiceRoleSupabaseClient` 利用箇所を一覧化
- [x] 用途を `read-only admin` / `write admin` で分類
- [x] 不要な service-role 利用を anon/RLS 経路へ戻す

3. RLS/API ガード方針の定義
- [ ] 「DB で必ず守る条件」を定義
- [ ] 「API 層で先に弾く条件」を定義
- [ ] 例外（Webhook, background job）の方針を記載

4. Webhook 検証の強化
- [ ] 既存 token/resource 検証のテストを追加
- [x] replay 対策（message number の再利用拒否）を設計
- [x] 失敗時の監査ログを最小情報で記録

## 完了条件
- [x] 管理者判定が環境変数ベースに統一されている
- [x] service-role の使用理由が全箇所で説明可能
- [ ] RLS/API の責務がドキュメント化されている

## service-role 利用棚卸し（2026-02-16）
- `app/api/boards/route.ts`: `read-only admin`（管理者向け board 一覧取得）
- `app/api/boards/[boardId]/route.ts`: `write admin`（管理者による board 更新/削除）
- `app/api/integrations/google-calendar/webhook/route.ts`: `write admin`（Webhook 受信時の同期状態更新）
- `lib/server/notifications.ts`: `write admin`（通知作成・重複制御）
- `lib/cards.ts`: `read-only admin`（short_id からのカード参照）
- `app/api/e2e/ensure-user/route.ts`: `write admin`（E2E 用ユーザー作成）

## 備考
- `app/api/e2e/ensure-user/route.ts` はテスト専用経路のため、本番無効化（`NODE_ENV` / `VERCEL_ENV`）と secret ヘッダ検証を必須条件とする。
