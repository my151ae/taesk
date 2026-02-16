# Phase 2: 権限/秘密情報の設計統一

## 目標
- 管理者判定と service-role 利用方針を一本化する。
- RLS と API ガードの責務分担を明文化する。

## タスク分解
1. 管理者判定の統一
- [ ] `lib/admins.ts` の固定メール判定を廃止
- [ ] `ADMIN_USER_IDS` のみで判定する実装へ移行
- [ ] 管理者の設定手順を `docs/` に追加

2. service-role 利用箇所の棚卸し
- [ ] `createServiceRoleSupabaseClient` 利用箇所を一覧化
- [ ] 用途を `read-only admin` / `write admin` で分類
- [ ] 不要な service-role 利用を anon/RLS 経路へ戻す

3. RLS/API ガード方針の定義
- [ ] 「DB で必ず守る条件」を定義
- [ ] 「API 層で先に弾く条件」を定義
- [ ] 例外（Webhook, background job）の方針を記載

4. Webhook 検証の強化
- [ ] 既存 token/resource 検証のテストを追加
- [ ] replay 対策（message number の再利用拒否）を設計
- [ ] 失敗時の監査ログを最小情報で記録

## 完了条件
- [ ] 管理者判定が環境変数ベースに統一されている
- [ ] service-role の使用理由が全箇所で説明可能
- [ ] RLS/API の責務がドキュメント化されている
