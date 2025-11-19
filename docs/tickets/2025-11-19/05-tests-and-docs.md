# 05 - Tests & Documentation

## 目的
Timeline がデフォルトボードとなった状態をテスト・ドキュメントに反映し、E2E でも新フローを担保できるようにする。

## 作業項目
- [ ] `e2e/timeline.spec.ts` を拡張し、ヘッダー機能/フィルター/モーダル/リアルタイムなど主要操作のカバレッジを追加。
- [ ] `scripts/test-all-batches.sh` や `test-summary.js` に timeline バッチの扱いを追記。
- [ ] `docs/index.md`, `docs/detail/components.md`, `docs/detail/testing.md` 等を更新し、主要 UI が Timeline ベースであることを明記。
- [ ] 既存の Kanban 関連ドキュメントに注意書きを追加（旧 UI はアーカイブ扱い）。

## 完了条件
- Playwright `timeline` バッチが CI で安定的に通る。
- ドキュメント/アーキテクチャ資料が新 UI に沿った内容へ更新される。
