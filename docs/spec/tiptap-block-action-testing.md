# Tiptap Block Action Testing Notes

CardModal 本文エディタの block action（`insert-above` / `insert-below` / `duplicate` / `delete`）を E2E で検証するときの注意点をまとめる。対象実装は [`app/(board)/_components/tiptap/TiptapEditor.tsx`](/Users/yossydie/dev/taesk/app/(board)/_components/tiptap/TiptapEditor.tsx) と [`e2e/timeline.spec.ts`](/Users/yossydie/dev/taesk/e2e/timeline.spec.ts)。

## 要点

- Tiptap / ProseMirror の block action は、見た目 DOM の `> p` / `> h2` 件数より **保存 JSON** と **handle metadata** を優先して確認する。
- autosave は [`app/components/CardModal.tsx`](/Users/yossydie/dev/taesk/app/components/CardModal.tsx) で `2000ms` debounce + `15000ms` max wait のため、E2E は `waitForTimeout` ではなく `expect.poll` を使う。
- menu の keyboard navigation と action 実行は分離して考える。focus/Arrow/Escape の検証と、menu item click による action 実行の検証を分ける方が安定する。

## どこを見るか

### 1. handle を block identity とみなす

本文エディタの block handle は hover DOM 逆引きではなく、`editor.state.doc.descendants(...)` と `getBlockTargetAtPos(...)` から `renderableBlocks` を作って描画する。E2E では本文 DOM の見た目ではなく、以下を起点にする。

- `data-testid="tiptap-block-handle"`
- `data-block-node-type`
- `data-block-pos`
- `data-block-start-pos`

### 2. 保存結果をポーリングする

block action 実行後の保存確認は、固定 sleep ではなく `expect.poll` で `cards.content` を取得する。

確認対象:

- top-level `content` の `type` 配列
- paragraph / heading の件数
- 必要なら `excerpt`

## 今回の切り分けで確定したこと

### `insert-above`

- `menuTargetPos` と `resolvedTargetPos` は paragraph を正しく指していた。
- それでも top-level 期待がずれたため、原因は target 特定ではなく **top-level 挿入 helper の実装** だった。
- 修正後は top-level children 配列を組み直して `replaceWith` する形で安定した。

### `duplicate`

- heading handle の `menuTargetPos` / `resolvedTargetPos` は heading を指していた。
- helper 実行後に `onChange(tr.doc.toJSON())` を直接流して autosave 経路へ確実に載せる必要があった。

## 推奨テスト方針

1. `openBlockActionMenu()` で menu 表示と初期 focus を確認する。
2. keyboard navigation は `ArrowUp` / `ArrowDown` / `Escape` のみ別テストで確認する。
3. action 実行テストは menu item click を使い、保存 JSON を `expect.poll` で確認する。
4. 末尾空 paragraph が追加されうるため、`> p` の単純件数は補助扱いに留める。

## 検証コマンド

```bash
PW_WORKERS=1 npx playwright test e2e/timeline.spec.ts \
  --grep "supports block actions|updates top-level paragraphs|duplicates heading|supported top-level blocks|pressing Escape closes block menu" \
  --reporter=json > test-results/playwright-block-actions.json
```

レポート確認:

```bash
cat test-results/playwright-block-actions.json | jq '.stats'
```
