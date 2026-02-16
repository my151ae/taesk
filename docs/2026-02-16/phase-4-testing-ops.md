# Phase 4: テスト/監視/運用定着

## 目標
- 変更を継続運用可能にし、回帰を自動検出できる状態にする。

## タスク分解
1. セキュリティ回帰テスト追加
- [x] 越権アクセス（他 board_id）を拒否する E2E/API テストを追加
- [x] 管理者専用経路のテストを追加
- [x] Webhook 偽装・E2E API 無効化のテストを追加

2. JSON レポート運用の固定化
- [x] 実行コマンドを `PW_WORKERS=1` 前提でドキュメント化
- [x] `test-results/playwright-report.json` の確認手順を固定化
- [x] 失敗分類（authz/validation/infra）のテンプレートを作成

3. 監査ログ/観測性
- [x] 重要操作（board/card settings change）の監査項目を定義
- [x] 失敗時の構造化ログ項目を定義
- [x] トリアージ手順を `docs/` に記載

4. 完了判定
- [x] `npm run lint`
- [x] `npm run build`
- [x] `PW_WORKERS=1 npx playwright test --reporter=json > test-results/playwright-report.json`
- [x] `.stats.unexpected == 0` を確認

## 完了条件
- [x] セキュリティ関連の回帰テストが CI 相当手順で安定
- [x] JSON レポートを使った障害解析フローが定着
- [x] 運用ドキュメントだけで再現可能な状態

## 追加した回帰テスト
- `e2e/security-hardening.spec.ts`
  - E2E endpoint 無効化（secret 無しは 404）
  - Origin 偽装ミューテーション拒否（`INVALID_ORIGIN`）
  - Webhook 偽装拒否（`UNAUTHORIZED_WEBHOOK`）

## 失敗分類テンプレート
- `authz`: 認証/認可失敗（401/403/404 by guard）
- `validation`: 入力不正（400/422）
- `infra`: 外部API/Supabase/ネットワーク/タイムアウト

## 監査ログ項目（最小）
- actor: `user.id`
- target: `board_id`, `card_id`
- action: `created|updated|deleted|moved`
- result: `success|failure`
- trace: request id / timestamp

## 構造化ログ項目（最小）
- `scope`（api route）
- `error_code`
- `status`
- `board_id`（存在する場合のみ）
- `user_id`（存在する場合のみ）

## トリアージ手順
1. `sed -n '/^{/,$p' test-results/playwright-report.json | jq '.stats'` で概要確認
2. `errors` と失敗 spec を抽出して `authz/validation/infra` に分類
3. 同じ分類で再実行し、再現率を記録
