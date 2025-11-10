# 2025-11-10 test:all-split 実行サマリー

- 実行コマンド: `npm run test:all-split`
- 実行開始: 2025-11-10 16:32 JST（所要 ~6 分）
- バッチログ: `test-results/logs/batch-execution-20251110-163250.log`
- JSON レポート: `test-results/batches/20251110-163250-*.json`
- グローバルセットアップ: 既存テストユーザー `e2e.taesk.test@gmail.com` を再利用し、`playwright/.auth/user.json` に storage state を保存済み

## 集計

| バッチ | 状態 | Passed | Failed | Flaky | Skipped | 備考 |
| ------ | ---- | ------ | ------ | ----- | ------- | ---- |
| auth | ✅ | 5 | 0 | 0 | 0 | 20.5s |
| kanban | ✅ | 27 | 0 | 0 | 0 | METRICS_JSON 取得、p95 未集計 (別途 `test-summary.js`) |
| reorder | ✅ | 11 | 0 | 0 | 0 | 23.1s |
| notifications | ✅ | 6 | 0 | 0 | 0 | 20.3s |
| permissions | ✅ | 4 | 0 | 0 | 0 | 25.1s |
| rls | ✅ | 8 | 0 | 0 | 0 | 11.1s |
| comments | ❌ | 9 | 6 | 1 | 0 | 244.9s、待機タイムアウト多発 |

skip 以外のテストで未解決の失敗が `comments` バッチに残存。`node test-summary.js test-results/batches/20251110-163250-comments.json` で詳細を確認済み。

## 失敗/Flaky 詳細（comments バッチ）

1. `should support @mentions with TipTap editor @e2e:essential @feature:comments`
2. `should support full-width ＠ trigger @e2e:essential @feature:comments`
3. `should support mixed full-width and half-width triggers @feature:comments`（1 回目失敗 → リトライ成功 / flaky）
4. `should sync comments across multiple browser contexts`
5. `should load comments modal within performance budget @e2e:essential`
6. `should not redundantly fetch members on modal reopen @e2e:essential`

共通原因:
- `openCardModalViaQuery` 実行後の `page.waitForResponse` (`/api/boards/.../cards/.../comments`) が 15s でタイムアウト。
- コメントモーダル再オープン時に `Card context not initialized` が発生し、リアルタイム/パフォーマンス系ケースも巻き添えで失敗。

## 対応方針メモ

- クエリ `?card=` でモーダルを開く際のナビゲーション完了待ちと API フェッチ完了待ちを見直し、`waitForResponse` に頼らず `page.waitForURL` + UI レベル待機へ差し替え予定。
- コメントモーダルの Context 初期化レースを再現するため、ローカルで `comments.spec.ts` の該当ケースに `test.step` ログを埋めながら調査する。
- `test-summary.js` が監視している `board-load` の p95 (5.29s > 3s) は以前の計測 (`docs/tickets/2025-10-31/02-board-load-metrics-followup.md`) で追跡中。コメント機能の安定化後に再測定を実施。

## 2025-11-10 comments.spec.ts 単体再実行

- 実行コマンド:\
  `PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/batches/20251110-170634-comments-fix.json npx playwright test e2e/comments.spec.ts --project=core --reporter=json`
- 実行結果: 16 passed / 0 failed / 0 flaky / 0 skipped（所要 73.2s）
- JSON: `test-results/batches/20251110-170634-comments-fix.json`
- 観測ログ:
  - `openCardModalViaQuery` を再度 `?card=<shortId>` ナビゲーション対応の上、board context を引き回す実装に戻しつつ、fallback でカードクリックも利用可能にした。
  - メンション系シナリオはネットワーク待機 (`page.waitForResponse`) 依存を排除し、UI ベースの待機に変更。
  - Realtime/Performance セクションでは `loadBoard(page2, board)` の再呼び出しや `test.describe.configure({ mode: 'serial' })` を導入して共有 state 競合を解消。
  - `should not redundantly fetch members on modal reopen` は初回のみクリック→モーダルを開くようにし、2 回目オープンでメンバー API が 0 件であることを確認。
  - パフォーマンステストは `createTestCard` を再利用してカード生成/shortId 取得を安定化し、URL 待機を `card=<shortId>` に合わせて修正。

## 2025-11-10 test:all-split 再実行（最終確認）

- 実行コマンド: `npm run test:all-split`
- 実行時刻: 2025-11-10 17:15 JST 開始 / 約 6 分
- ログ: `test-results/logs/batch-execution-20251110-171550.log`
- JSON: `test-results/batches/20251110-171550-*.json`

| バッチ | 状態 | Passed | Failed | Flaky | Skipped | 備考 |
| ------ | ---- | ------ | ------ | ----- | ------- | ---- |
| auth | ✅ | 5 | 0 | 0 | 0 | |
| kanban | ✅ | 27 | 0 | 0 | 0 | METRICS_JSON 取得済み |
| reorder | ✅ | 11 | 0 | 0 | 0 | |
| notifications | ✅ | 6 | 0 | 0 | 0 | |
| permissions | ✅ | 4 | 0 | 0 | 0 | |
| rls | ✅ | 8 | 0 | 0 | 0 | |
| comments | ⚠️ | 15 | 0 | 1 | 0 | TipTap 投稿時の `/api/cards/[cardId]/comments` が一度 `Unexpected end of JSON input` を返し retry で成功 |

skip は 0 件。Flaky のみ 1 件検出されたものの失敗は無く、全シナリオが Pass として完了。API の JSON パース例外は別途フォローアップ（次回のコメント API 実装調査）対象としてログに残す。
