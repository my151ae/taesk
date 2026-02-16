# Phase 1: 境界防御の即時強化

## 目標
- 未認証/越権/偽装リクエストを初期段階で遮断する。
- ログから機微情報が漏れない状態にする。

## タスク分解
1. 共通ガード導入
- [x] `withAuth`（認証必須）を実装
- [x] `withBoardAccess`（board member + role 判定）を実装
- [x] 主要な更新系 API（POST/PATCH/DELETE）に適用

2. CSRF/Origin 防御
- [x] 重要 API で `Origin`/`Host` を検証
- [x] 非ブラウザ経路（Webhook/E2E）を例外経路として明示
- [x] 失敗時のエラーレスポンス形式を統一

3. E2E エンドポイント強化
- [x] `app/api/e2e/*` を明示フラグがない限り無効化
- [x] `assertE2EEnabled` の運用条件を docs に明記
- [ ] 本番環境で到達不能であることをテストで検証

4. ログマスキング
- [x] OAuth/Webhook まわりにマスク関数を導入
- [x] token / email / provider error detail の出力基準を決定
- [x] `console.error` の出力フォーマットを統一

## 完了条件
- [x] 更新系 API が共通ガード経由になっている
- [x] E2E API が通常運用環境で無効化されている
- [x] 機微情報を含むログが出力されない

## E2E ガード運用条件（assertE2EEnabled）
- `NODE_ENV=production` もしくは `VERCEL_ENV=production` では常に拒否
- `E2E_ENABLED=true` が必要
- `E2E_SECRET` が設定済みであること
- リクエストヘッダ `x-e2e-secret` が `E2E_SECRET` と timing-safe 比較で一致すること
