# Phase 1: 境界防御の即時強化

## 目標
- 未認証/越権/偽装リクエストを初期段階で遮断する。
- ログから機微情報が漏れない状態にする。

## タスク分解
1. 共通ガード導入
- [ ] `withAuth`（認証必須）を実装
- [ ] `withBoardAccess`（board member + role 判定）を実装
- [ ] 主要な更新系 API（POST/PATCH/DELETE）に適用

2. CSRF/Origin 防御
- [ ] 重要 API で `Origin`/`Host` を検証
- [ ] 非ブラウザ経路（Webhook/E2E）を例外経路として明示
- [ ] 失敗時のエラーレスポンス形式を統一

3. E2E エンドポイント強化
- [ ] `app/api/e2e/*` を明示フラグがない限り無効化
- [ ] `assertE2EEnabled` の運用条件を docs に明記
- [ ] 本番環境で到達不能であることをテストで検証

4. ログマスキング
- [ ] OAuth/Webhook まわりにマスク関数を導入
- [ ] token / email / provider error detail の出力基準を決定
- [ ] `console.error` の出力フォーマットを統一

## 完了条件
- [ ] 更新系 API が共通ガード経由になっている
- [ ] E2E API が通常運用環境で無効化されている
- [ ] 機微情報を含むログが出力されない
