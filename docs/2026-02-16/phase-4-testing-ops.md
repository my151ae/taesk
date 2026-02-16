# Phase 4: テスト/監視/運用定着

## 目標
- 変更を継続運用可能にし、回帰を自動検出できる状態にする。

## タスク分解
1. セキュリティ回帰テスト追加
- [ ] 越権アクセス（他 board_id）を拒否する E2E/API テストを追加
- [ ] 管理者専用経路のテストを追加
- [ ] Webhook 偽装・E2E API 無効化のテストを追加

2. JSON レポート運用の固定化
- [x] 実行コマンドを `PW_WORKERS=1` 前提でドキュメント化
- [x] `test-results/playwright-report.json` の確認手順を固定化
- [ ] 失敗分類（authz/validation/infra）のテンプレートを作成

3. 監査ログ/観測性
- [ ] 重要操作（board/card settings change）の監査項目を定義
- [ ] 失敗時の構造化ログ項目を定義
- [ ] トリアージ手順を `docs/` に記載

4. 完了判定
- [x] `npm run lint`
- [x] `npm run build`
- [x] `PW_WORKERS=1 npx playwright test --reporter=json > test-results/playwright-report.json`
- [x] `.stats.unexpected == 0` を確認

## 完了条件
- [ ] セキュリティ関連の回帰テストが CI 相当手順で安定
- [ ] JSON レポートを使った障害解析フローが定着
- [ ] 運用ドキュメントだけで再現可能な状態
