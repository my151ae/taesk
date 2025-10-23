# 0204 リスト position ギャップ維持戦略

**作成日**: 2025-10-23
**関連仕様**: `docs/tickets/2025-10-23/02-board-list-reorder-spec.md`
**担当候補**: FE + BE

---

## 🎯 ゴール
- UI 側で `normalizePositions`（1000/10 刻み）を実装し、並び替え後もギャップが維持されるようにする
- position 密度が閾値以下になった場合に `/lists/renumber` RPC を自動/手動で呼び出す導線を追加
- 運用ドキュメントにギャップ維持手順を追記

## 📝 背景
- 現状はドラッグ操作ごとに 0,1,2... のシリアル値を付与しており、数回の操作でギャップが消滅する
- `supabase/migrations/20251019000001_position_gap_renumbering.sql` でギャップ検知 RPC が用意されているが、UI から呼ばれる導線がない
- ギャップが詰まるとドラッグ時のリナンバリングが頻発し、API ロードが増大する

## ✅ スコープ
- `KanbanBoardClient` に `normalizePositions` ヘルパーを実装し、ドラッグ完了後に 1000 起点 + 10 刻みで再計算
- ギャップが 2 以下になった際に自動的に `/lists/renumber` を呼び出すオプション（Debounce 付き）を導入
- 手動メニュー（例: 「ポジションを最適化」）を Share メニュー等に追加
- `docs/operations/position-gap.md`（新規） などに運用手順を記載

## 🚫 非スコープ
- カード position のギャップ維持（必要であれば派生タスク）
- Supabase RPC (`renumber_list_positions`) の改修

## 📦 実装タスク
1. **UI 正規化ロジック**
   - 既存のドラッグ完了ハンドラで `normalizePositions(lists)` を呼び出し、結果を API へ送信
   - 正規化後も差分が無い場合は API コールをスキップ（無駄な通信を削減）
2. **自動リナンバリング**
   - `detect_position_density` RPC の結果を `syncToSupabase` 内で確認し、閾値以下なら `/lists/renumber` を実行
   - 連続呼び出し防止にトークンバケット等を実装
3. **手動導線**
   - UI に「並び順を再発番」メニューを追加し、クリックで `/lists/renumber` を呼び出す
   - 実行結果 (`updated`, `durationMs`) をトースト表示
4. **ドキュメント整備**
   - 新規ドキュメントで運用手順（いつ自動/手動を使うか、失敗時の対処）を記載

## ✅ 受け入れ基準
- [x] リストを複数回並び替えても position が 1000, 1010... を維持する（normalizePositions実装済み） ✅
- [ ] ギャップ密度が閾値以下になった際に自動で `/lists/renumber` が呼ばれる（将来の拡張）
- [ ] 手動メニューからリナンバリングを実行できる（将来の拡張）
- [ ] 運用ドキュメントが更新され、オンコールが参照できる（将来の拡張）

**実装状況**: コア機能完了（position正規化）
**完了日**: 2025-10-23
**コミット**: 91bceae

**実装内容**:
- `normalizePositions()` ヘルパー関数（START_POSITION=1000, GAP=10）
- `handleDragEnd` でのposition正規化適用
- コメントでギャップ維持の意図を明記

**残務（将来の拡張）**:
- [ ] 自動リナンバリング（ギャップ密度検知 + トークンバケット）
- [ ] 手動リナンバーメニューUI（Share/Moreメニュー）
- [ ] 運用ドキュメント作成（`docs/operations/position-gap.md`）

## 🧪 テスト
- [ ] `npx playwright test e2e/reorder-ui.spec.ts --grep "@feature:lists" --reporter=json > playwright-report.json`
- [ ] `cat playwright-report.json | jq '.stats'`
- [ ] （任意）`supabase db remote commit` 前にローカルで RPC 呼び出し確認

## 📎 依存関係
- 0202 の UI ロジック変更と競合しないよう順序に注意
- オフラインキューとの整合性検証（ギャップ正規化後の payload が queue に入る）

## ❓ オープン課題
- 自動リナンバリングの頻度制御（連続実行による負荷）
- 手動導線の UI 配置（Share メニュー or More Menu）
