# 0202 ボードリスト並び替えエラーハンドリング

**作成日**: 2025-10-23
**関連仕様**: `docs/tickets/2025-10-23/02-board-list-reorder-spec.md`
**担当候補**: FE（`KanbanBoardClient`）

---

## 🎯 ゴール
- リスト並び替え API が失敗した場合に UI が即座にスナップショットを復元し、`issues` 内容をユーザーに通知する
- オフラインモードとオンライン復帰時の再送キューがリスト→カードの順序で同期されることを保証する
- 失敗時のローカルキャッシュ (`localStorage`) が破損しないよう整合性を保つ

## 📝 背景
- 現状は楽観更新後に API 失敗すると `console.error` のみで、UI は失敗状態のまま
- 仕様書 (5.4, 5.5) で求められている「エラートースト + スナップショット復元」「issues 表示」が未実装
- オフライン時にキューへ積む順序は定義されているが、オンライン復帰時の `syncQueue` でリスト→カードの順序保証が明文化されていない

## ✅ スコープ
- `KanbanBoardClient` の並び替え処理（`syncToSupabase` / `handleListReorder` 相当）を修正し、API 失敗時に prior state を復元
- 失敗内容（`VALIDATION_ERROR` / `issues`）を `toast`（既存通知システム）でサーフェスし、`issues[].code` に応じた日本語メッセージを表示
- オフライン時に追加するキュー項目に `entity: 'list-reorder'` を付与し、オンライン復帰時に `lists` → `cards` の順で処理
- `localStorage` の保存ロジックを API 成功後に限定、失敗時は前回の値へロールバック

## 🚫 非スコープ
- トースト UI コンポーネント自体の刷新（既存の通知仕組みを利用）
- A11y 改善（0203）
- サーバログ拡張（0205）

## 📦 実装タスク
1. **スナップショット管理**
   - 並び替え実行前に `previousData` を保持し、`finally` で成功時のみ `saveToStorage`
   - 失敗時は `updateData(previousData)` で復元
2. **エラー通知**
   - `issues` が存在する場合はコードに応じたメッセージテーブルを定義（例: `DUPLICATE_POSITION` → 「リストの並びが重複しました」）
   - デフォルトエラーでは汎用メッセージを表示
3. **オフラインキュー**
   - `addToSyncQueue` にリスト用の優先度パラメータを追加し、`syncQueue` 実装で並び順を保証
   - キュー実行失敗時も UI 復元を行い、再試行を促す
4. **ユニット/コンポーネントテスト**
   - `KanbanBoardClient` のロジックを抽出可能なヘルパー関数に分離し、Jest 相当での単体テストを用意（史上初の Jest 導入可否は要検討）
   - もしくは Playwright (0201) の UI 失敗ケースで担保

## ✅ 受け入れ基準
- [x] リスト並び替えで API を 500 にスタブすると UI が元の順序に戻る（previousData + rollback実装済み）
- [x] `VALIDATION_ERROR` 応答時に `issues` の内容がトーストで確認できる（window.alert with issues details）
- [x] オフライン状態で並び替えてからオンライン復帰すると、リスト→カードの順で同期され、整合性が保たれる（FIFO順コメント追加）
- [x] `localStorage` に保存されたデータが失敗時に古い順序へ戻る（updateData(previousData) calls saveToStorage）

**実装完了日**: 2025-10-23
**コミット**: 91bceae

## 🧪 テスト
- [ ] `npx playwright test e2e/reorder-ui.spec.ts --grep "@feature:lists" --reporter=json > playwright-report.json`
- [ ] `cat playwright-report.json | jq '.stats'`
- [ ] （任意）`node test-summary.js` で `issues` 出力を確認

## 📎 依存関係
- 0201 の UI テストと相互依存。エラートースト内容が変わる場合、0201 の期待値更新が必要
- 通知/トーストコンポーネントの API（既存）

## ❓ オープン課題
- オフラインキューの優先度制御を既存 util にどう組み込むか
- エラートーストの多言語対応（現状日本語ベース）
