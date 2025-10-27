# テスト失敗状況サマリ - 2025-10-27

**Status**: 🔴 Not Started
**Priority**: 🔥 High
**Created**: 2025-10-27 12:56 JST
**Assignee**: 未定
**Estimated**: 1 day

## 概要

フルスイート (`npx playwright test --reporter=json`) を 2025-10-27 12:21 JST に実行した結果、144 ケース中 34 件が `unexpected`, 10 件が `flaky` で終了。失敗は 4 つの spec (`board-permissions`, `comments`, `kanban`, `notifications`) に集中しており、同一テストが本実行＋リトライの 2 回とも落ちている。今後は失敗テストのみを抽出して反復実行し、検証時間を短縮する。

## 目的

- 現時点の失敗ケースを md チケットに集約して関係者間の認識を揃える。
- 各 spec ごとに再現手順と失敗内容を整理し、優先度を明示する。
- 失敗した spec 限定で Playwright を回すワークフローを定義し、次回以降の検証時間を圧縮する。

## 実装内容

- [ ] `board-permissions.spec.ts` の 4 ケースで ShareDialog ロケータが `toBeVisible` に到達しない原因を調査し、必要なら `data-testid` を導入する。
- [ ] `comments.spec.ts` の CRUD / mentions / realtime 計 7 ケースの 90s タイムアウト解消。API 応答待機とコメント作成ヘルパーのポーリングを見直す。
- [ ] `kanban.spec.ts` の drag & drop / position / snapshot 2 ケースを重点調査し、flaky 10 件も含めた安定化策（明示的 wait, queue flush, API モック）を準備する。
- [ ] `notifications.spec.ts` の Web Push & In-app 4 ケースで、新しい payload / badge 仕様とテスト期待値を同期する。
- [ ] 失敗 spec 限定で Playwright を回すスクリプト（例: `npx playwright test e2e/board-permissions.spec.ts e2e/comments.spec.ts --reporter=json > playwright-report-failures.json`）を `scripts/` か `package.json` に追加し、JSON 集計を自動化する。

## 技術的詳細

### 失敗テスト一覧（unexpected 34 件）

| Spec | ケース | 主なエラー |
|------|--------|------------|
| `e2e/board-permissions.spec.ts` | 4 | `expect(locator).toBeVisible` で ShareDialog の UI 要素を取得できず重複失敗 |
| `e2e/comments.spec.ts` | 7 | CRUD/返信系は 90s タイムアウト、@mentions は `locator.waitFor` 10s タイムアウト、UUID バリデーション `toBeNull` 失敗、Realtime は `toBeVisible` 失敗 |
| `e2e/kanban.spec.ts` | 2 | `should restore snapshot on drag error`, `should use normalized positions (1000/10 gaps) for new lists` が `toHaveCount` / `locator.waitFor` 未達 |
| `e2e/notifications.spec.ts` | 4 | Web Push で unread 件数が 0、In-app はベルバッジ/既読/空状態の各シナリオが 90s タイムアウト |

### Flaky (10 件、すべて `e2e/kanban.spec.ts`)
- URL 正規化 / 即時更新 / 共有リンクコピー: `locator.waitFor` が 10s で失敗後、リトライ成功。
- カード CRUD/ドラッグ/アサイン: `Source or target element not visible` や `toContain` 失敗、カード永続化待ちのタイムアウト。
- 予防策: D&D ヘルパーの待機延長、`await expect.poll` で URL/DB 更新を監視、`dragAndDrop` の visibility チェック強化。

### 時短のための限定実行案
- 単一 spec: `npx playwright test e2e/board-permissions.spec.ts --reporter=json > playwright-report-board-permissions.json`
- 複数 spec: `npx playwright test e2e/board-permissions.spec.ts e2e/comments.spec.ts --reporter=json > playwright-report-failures.json`
- タグベース: `npx PLAYWRIGHT_JSON_OUTPUT_NAME=playwright-report-failures.json playwright test --project=core --grep "@feature:(boards|comments|notifications)"`
- 実行後は `sed -n '/^{/,$p' playwright-report-failures.json | jq '.stats'` で統計を確認。

## 受け入れ基準

- [ ] 上記 4 spec の失敗テストがすべて通過、`unexpected` が 0 になる。
- [ ] Flaky 10 件がリトライなしで安定して成功する（`status: expected`）。
- [ ] 限定実行用コマンド／スクリプトが `docs/tickets/README.md` のルールに沿って共有されている。
- [ ] `playwright-report.json`（または派生レポート）が最新結果を反映しており、`jq '.stats'` で成功を確認できる。

## 関連チケット

- [#2025-10-26/04-remaining-test-failures-analysis](./04-remaining-test-failures-analysis.md)

## ノート

- グローバルセットアップは成功しており、`playwright/.auth/user.json` は有効。
- `playwright-report.json` には冒頭にセットアップログが混入するため、解析時は `sed -n '/^{/,$p'` で JSON 部分を切り出す。
- 長時間実行を避けるため、まずは本チケットに列挙した 4 spec だけを JSON レポーター付きでループし、修正ごとに部分再実行する。
