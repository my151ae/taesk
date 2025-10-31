# ボード読み込み計測リファクタリング結果まとめ

**Status**: 🟡 In Progress  
**Priority**: 🔥 High  
**Created**: 2025-10-31 2355  
**Assignee**: 未定  
**Estimated**: 4 hours

## 概要

ボード読み込みと永続化周りの計測基盤を整備し、ローカル実装の改善点・計測結果・残課題を整理する。

## 目的

パフォーマンス改善の方向性を具体化し、p95 指標で確実に改善を確認できる状態を作る。

## 実装内容

- [x] クライアント・サーバー双方でトレース ID を扱える軽量メトリクスラッパを導入 (`lib/metrics/*`)
- [x] Kanban ボード読み込み時の fetch/parse/シード/Storage 書き込みをトレース化し、localStorage 書き込みをスロットル
- [x] `/api/boards/[boardId]/data` に Supabase クエリ計測と payload サイズ集計を追加
- [x] オフライン同期キューを冪等キーで集約し、同期実行フローをトレース
- [x] Playwright から `METRICS_JSON` を収集し `test-summary.js` で p95 を評価
- [ ] コメント API と読み込み時の追加 fetch を計測し、ボード読み込み p95 を 3s 未満に抑える施策を検証

## 技術的詳細

- クライアント側のトレースは `window.__TAESK_METRICS__` に蓄積し、Playwright から `dumpClientMetrics` で取得
- サーバー側は `createServerTrace/measureStep/finalizeServerTrace` で JSON レスポンスにメトリクスを添付
- `test-summary.js` が JSON レポートから METRICS_JSON を抽出し、p95>threshold (デフォルト 3s) で非0終了
- `KanbanBoardClient` の localStorage 書き込みを 120ms デバウンスで制御し、フォールバック時もメトリクス記録
- `syncQueue` は冪等キーで集約しリトライ回数を追跡、成功/失敗件数をトレース送出

## 受け入れ基準

- [ ] board-load p95 が 3000ms 以下（Playwright `node test-summary.js` で ✅）
- [ ] コメント読み込み遅延の原因が特定され、改善計画が明文化
- [ ] メトリクス収集で追加ログを生成する場合、不要な個人情報は含まれない

## 関連チケット

- [#2025-10-31/01-refactor-storage-performance](./01-refactor-storage-performance.md)

## ノート

- 最新のテスト結果: `npx playwright test e2e/kanban.spec.ts --project=core --grep "@e2e:essential" --reporter=json | tee playwright-report.json` 実行後、`node test-summary.js test-results/playwright-report.json` が `board-load p95 = 5292.8ms (threshold 3000ms)` と判定し非0終了。ボード読み込み自体は成功しているが、Supabase クエリが ~5.3s かかるケースが残課題。
- コメント一覧取得や追加 fetch の計測ポイントを増やし、遅延集中箇所を特定して次ステップに進む。
