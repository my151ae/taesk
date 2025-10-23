# 0201 ボードリスト並び替えテスト強化

**作成日**: 2025-10-23
**関連仕様**: `docs/tickets/2025-10-23/02-board-list-reorder-spec.md`
**担当候補**: QA / FE (Playwright), BE (API 検証補助)

---

## 🎯 ゴール
- `PATCH /api/boards/:boardId/lists/reorder` のバリデーション失敗パターン（`DUPLICATE_POSITION` など）を e2e テストで網羅し、サーバ仕様 (A1-A5) を回帰可能にする
- リスト並び替え UI → API → ページ再読込までのフローを Playwright で自動化し、`@feature:lists`/`@e2e:essential` のタグ方針に組み込む
- 失敗時 JSON レポートから `issues` 内容を抽出できるサマリースクリプト（`test-summary.js`）の拡張を行う

## 📝 背景
- 現在の `e2e/reorder-api.spec.ts` はカード向けの詳細バリデーションとリスト成功系のみを確認しており、リスト側 `VALIDATION_ERROR` の細分化が未カバー
- UI でのドラッグ&ドロップフローは Smoke テストに含まれていないため、回帰検知が遅延している
- JSON レポート運用へ移行済みだが、`issues` 内訳を要約する補助ツールがない

## ✅ スコープ
- `e2e/reorder-api.spec.ts` にリスト向け `DUPLICATE_POSITION`・`UNKNOWN_ID`・`CROSS_BOARD` のテストケースを追加
- 既存 `e2e/kanban.spec.ts` のドラッグ&ドロップテストを拡張し、並び替え→再読込のシナリオを `@feature:boards` + `@e2e:essential` で追加
- JSON レポートの `suites[].tests[].errors[].message` から `issues` 内容を抽出する `test-summary.js`（新規）を作成
- テスト作成に伴うボード/リスト初期化ヘルパーの整備（必要に応じて `e2e/utils/` 配下）

## 🚫 非スコープ
- API 本体のロジック変更（別チケットで扱う）
- UI のエラー表示改善（0202）
- キーボード/A11y 対応（0203）

## 📦 実装タスク
1. **API e2e 拡張** (`e2e/reorder-api.spec.ts`)
   - リスト向け `DUPLICATE_POSITION` テストを追加（2つのリストに同じpositionを指定）
   - リスト向け `UNKNOWN_ID` テストを追加（存在しないリストIDを指定）
   - リスト向け `CROSS_BOARD` テストを追加（別ボードのリストIDを含める）
   - 各テストで `result.issues` 内の `code` を厳密比較
   - `@failure:validation` タグを付与（CI最小セットでは除外）
2. **UI e2e 拡張** (`e2e/kanban.spec.ts`)
   - 既存のドラッグ&ドロップテストを確認・補強
   - リスト並び替え→ページ再読込→順序維持を検証するテストを追加（`@e2e:essential`）
3. **test-summary.js 作成**
   - `playwright-report.json` から統計情報を読み取る
   - 失敗テストの `issues` 配列を抽出・整形して表示
   - 使用例: `npm run test:summary` または `node test-summary.js`
4. **ドキュメント更新**
   - `docs/detail/testing.md` に `test-summary.js` の使用方法を追記

## ✅ 受け入れ基準
- [ ] `e2e/reorder-api.spec.ts` でリスト向け `DUPLICATE_POSITION`・`UNKNOWN_ID`・`CROSS_BOARD` の各ケースが 400 を返し、`issues[].code` を検証
- [ ] `e2e/kanban.spec.ts` のリスト並び替えテストがドラッグ&ドロップ→再読込→順序維持を検証し、`@e2e:essential` として実行できる
- [ ] `test-summary.js` で `playwright-report.json` から統計と失敗テストの `issues` を整形表示できる
- [ ] 追加テストが `npm run test:feature:boards` および `npm run test:failure` で安定実行（CI=workers:1）

## 🧪 テスト
- [ ] `npm run test:feature:boards` - ボード機能テスト（リスト並び替え含む）
- [ ] `npm run test:failure` - 異常系テスト（新規バリデーションテスト含む）
- [ ] `npm run test:summary` - JSON レポートの統計確認
- [ ] 必要に応じて `PLAYWRIGHT_JSON_OUTPUT_NAME` を切り替え、複数レポートを比較

## 📎 依存関係
- 0202 (UI のエラー表示改善) と並行可能だが、0202 のアラート挙動変更に追随する必要あり
- API ロジック変更が入る場合はテストケースの期待値更新が必要

## ❓ オープン課題
- UI 失敗ケースの再現性確保（サーバエラーをどう誘発するか）
- ローカルと CI でのドラッグ挙動の安定性（`page.mouse` vs. `dragAndDrop` ヘルパー）
