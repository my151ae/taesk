# Playwright E2E テスト結果 - 2025-10-26 08:31 JST

**Status**: 🔴 Not Started
**Priority**: 🔵 Medium
**Created**: 2025-10-26 08:45 JST
**Assignee**: 未定
**Estimated**: -

## 概要

`npx playwright test --reporter=json > playwright-report.json` を実行し、現時点の E2E 失敗状況を集計。93件成功・46件失敗・5件スキップで、主要な欠陥はボード共有権限、コメント機能、通知、リスト並び替え API 周辺に集中している。

## 実行メタデータ

- **開始時刻**: 2025-10-26 08:31 JST (report.stats.startTime: 2025-10-25T23:31:19.927Z)
- **実行時間**: 約 777.15 秒
- **レポートファイル**: `playwright-report.json` (logs + JSON)
- **サマリーツール**: `node test-summary.js > test-summary.txt`

## 結果サマリー

| 指標 | 件数 |
| --- | ---: |
| ✅ Passed | 93 |
| ❌ Failed | 46 |
| ⏭️  Skipped | 5 |
| 🔄 Flaky | 0 |

## 失敗クラスター

1. **Board Permissions (`board-permissions.spec.ts`)** – ShareDialog、ロール変更、メンバー削除、非オーナーの操作制限など 8 ケースがタイムアウトや strict mode violation で失敗。
2. **Comments (`comments.spec.ts`)** – コメント作成/編集/削除/返信/@mention など 10 ケース以上が 30s タイムアウトまたは可視性アサーション失敗。
3. **Kanban Core (`kanban.spec.ts`)** – ラベルダイアログ、カード作成/コピー、ドラッグ復元、正規化ポジションといった重要シナリオが Assertion 失敗。
4. **Notifications (`notifications.spec.ts`)** – Web Push テスト通知、ベルの未読バッジ、既読処理、空状態、すべてが可視性 or タイムアウトで落下。
5. **Reorder API (`reorder-api.spec.ts`)** – 不正ID／クロスボード更新拒否テストが API レスポンス整合性エラー (`expect(received).toBe(expected)` / `Cannot read properties of undefined`) を複数件。

## 代表的エラー例

- `TimeoutError: locator.waitFor: Timeout 10000ms exceeded` (ShareDialog ボタン待機)
- `expect(locator).toBeVisible()` / `expect(received).toContain(expected)` など UI アサーション失敗
- API バリデーション: `expect(received).toBe(expected)` mismatch, `TypeError: Cannot read properties of undefined (reading '0')`

## 次のアクション候補

1. ボード権限・コメント機能の UI リグレッション確認（ShareDialog / Comments タブの要素セレクタ変更有無）
2. 通知シナリオの未読バッジ挙動（今回のファビコンバッジ対応による副作用含む）を手動再現し、必要ならテスト修正
3. Reorder API でのレスポンス payload・エラーメッセージ仕様を最新サーバー実装と同期
4. 失敗テストを `test-summary.txt` でトレースし、重複 (parallel shard) を一つずつ issue 化

## 参考ログ

- `playwright-report.json` (生JSON + stats)
- `test-summary.txt` (46件の失敗詳細リスト)
- HTML レポート: `npx playwright show-report --host 127.0.0.1 --port 9323`

## フォローアップ修正（2025-10-26）

- **対応内容**: `e2e/reorder-api.spec.ts` の `should reject unknown list IDs` が `INVALID_BODY` を受け取っていたため、APIレスポンス仕様に合わせて「存在しないがUUID仕様を満たすID」を使用し、Cross-board検証用の補助ボードID取得ロジックも `otherBoard.board.id` に修正。
- **スポット再実行**: `npx playwright test e2e/reorder-api.spec.ts --reporter=json > playwright-report-reorder.json` を実行し、サマリーを `test-summary-reorder.txt` に記録。結果は **22件成功 / 0件失敗 / 0件スキップ / 27.43s**。
- **成果物**: 上記 JSON / サマリーファイルはレポート作成後に削除済み（履歴はチケットに記載）。他の失敗テストは未着手のため、引き続き個別調査が必要。
