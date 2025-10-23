# 0203 ボードリスト並び替えアクセシビリティ改善

**作成日**: 2025-10-23
**関連仕様**: `docs/tickets/2025-10-23/02-board-list-reorder-spec.md`
**担当候補**: FE（A11y）

---

## 🎯 ゴール
- キーボード操作のみでリストを移動できるよう `Shift+Arrow` / `Ctrl+Shift+Arrow` ショートカットを追加
- ドラッグ操作時のフォーカス喪失を防ぎ、ロービング `tabIndex` + `aria-live` 通知でスクリーンリーダ対応を実現
- Playwright でキーボード操作フローを自動テスト化し、`@feature:lists` に含める

## 📝 背景
- 現在は `@dnd-kit` 既定の `KeyboardSensor` のみで、`Space` → `Arrow` → `Space` の操作に依存
- ロール/ラベルが不足し、ドラッグ開始時にフォーカスが外れるケースがある
- doc 02 の「今後の改善タスク」 #1 に列挙された要求が未対応

## ✅ スコープ
- リストヘッダー要素へ `role="listitem"` 相当の ARIA 属性と `aria-grabbed`・`aria-dropeffect` を適用
- フォーカスリング喪失を防ぐため、ドラッグ中に `tabIndex=-1` を適切に切り替えるロービングインデックス制御
- `aria-live="polite"` 領域を追加し、移動後に「リストを N 番目に移動しました」等のメッセージを発話
- キーボードショートカットを `keydown` ハンドラで実装し、`Shift+Arrow` で隣へ、`Ctrl+Shift+Arrow` で先頭/末尾へ移動

## 🚫 非スコープ
- カード並び替えのアクセシビリティ（別タスク）
- トーストなど視覚的フィードバック（0202）

## 📦 実装タスク
1. **A11y 属性追加**
   - `KanbanBoardClient` のリストコンポーネントに必要な ARIA 属性／ラベルを付与
   - `aria-describedby` でショートカットヘルプを提供
2. **フォーカス管理**
   - 現在選択中のリストインデックスを state で保持し、ドラッグ中でも `focus()` を維持
   - マウス操作とキーボード操作の両立を確認
3. **ショートカットの実装**
   - `Shift+ArrowLeft/Right` で前後に移動、`Ctrl+Shift+Arrow` で先頭/末尾
   - 操作後は API 同期ルーチンを共通化
4. **テスト追加**
   - Playwright で `KeyboardSensor` を経由せず `page.keyboard.press` を使用した E2E を追加
   - `@feature:lists` タグ + `@e2e:essential`（主要経路）

## ✅ 受け入れ基準
- [ ] キーボードのみでリストを並び替え、スクリーンリーダが「リスト『Todo』を2番目に移動しました」と読み上げる
- [ ] マウス/タッチ操作とキーボード操作が共存し、フォーカス喪失が発生しない
- [ ] Playwright テストで `page.keyboard.press('Shift+ArrowRight')` 等により順序変更が検証される

## 🧪 テスト
- [ ] `npx playwright test --project=core --grep "@feature:lists" --reporter=json > playwright-report.json`
- [ ] `cat playwright-report.json | jq '.stats'`
- [ ] アクセシビリティ検証には `@axe-core/playwright` の導入を検討（任意）

## 📎 依存関係
- 0202 のトースト表示と連携する際はメッセージ重複に注意
- キーボードショートカットのドキュメント更新（`docs/user-guide/*.md`）

## ❓ オープン課題
- 日本語/英語での読み上げ文言整備
- `aria-live` が連続通知される際のデバウンス処理
