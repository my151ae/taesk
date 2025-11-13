# タイムライン計測 & テスト整備

**Status**: 🔴 Not Started  
**Priority**: 🔵 Medium  
**Created**: 2025-11-13 14:45 JST  
**Assignee**: QA/Infra  
**Estimated**: 2d

## 概要
Timeline 機能の指標（ロード時間、イベント数、A/B 進捗、1 分単位スケジュール精度）を計測し、Playwright の JSON レポートベースで自動検証を追加する。Flaky が残る comments バッチとの兼ね合いも整理しつつ、通知/繰り返しが未実装でも進捗が追える状態にする。

## 目的
- 新 UI がパフォーマンス劣化やテスト不安定を招かないよう、測定と自動テストのセットを提供する。
- `npm run test:all-split` の `timeline` バッチを新設し、既存ログ/JSON 収集フローに組み込む。

## 実装内容
- [ ] `createClientTrace` / `metricsJson` に `timeline-render-ms`, `timeline-events-count`, `ab-items-count`, `timeline-minute-resolution-errors` を追加。
- [ ] `test-summary.js` で timeline メトリクスを集計し、p95 > 4s で警告を出す。
- [ ] Playwright バッチ `timeline` を `scripts/test-all-batches.sh` に追加。`PW_WORKERS=1` + `--reporter=json` ルールを順守。
- [ ] 代表シナリオ: イベント移動、A/B 追加、CardModal 編集 → JSON レポート解析で success を検証。
- [ ] コメントバッチとの依存関係を整理し、`docs/tickets/2025-11-10/01-test-all-split-summary.md` に記載の Flaky を回避できるよう waits を共有ヘルパー化。
- [ ] Timeline バッチはデスクトップのみ対象である旨をログに残し、通知/繰り返しが未実装であることを警告として記録。

## 技術的詳細
- メトリクスは `lib/metrics/client.ts` に `phase: "timeline"` を追加し、`TraceSummary` を更新。
- Playwright JSON は `test-results/batches/<timestamp>-timeline.json` に保存。`AGENTS.md` の「JSON レポート必須」ルールを必ず遵守。
- `Timeline` バッチでは Next.js dev サーバーを起動しないため、`webServer.command` の `PORT` 衝突も監視。

## 受け入れ基準
- [ ] `npm run test:all-split` で timeline バッチが走り、JSON/ログが保存される。
- [ ] `test-summary.js` 出力に timeline 指標が追加される。
- [ ] CI/ローカルともに Flaky 0 で 2 回連続パス。

## 関連チケット
- [03-timeline-ui-shell.md](./03-timeline-ui-shell.md)
- [04-timeline-drag-drop.md](./04-timeline-drag-drop.md)
- [00- TaeskMap マスタープラン](./00-today-list-layout.md)
