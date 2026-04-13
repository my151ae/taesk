# Tiptap Block Action Testing Notes

CardModal 本文エディタの block action（`move-up` / `move-down` / `insert-above` / `insert-below` / `duplicate` / `delete`）を E2E で検証するときの注意点をまとめる。対象実装は [`app/(board)/_components/tiptap/TiptapEditor.tsx`](/Users/yossydie/dev/taesk/app/(board)/_components/tiptap/TiptapEditor.tsx) と [`e2e/timeline.spec.ts`](/Users/yossydie/dev/taesk/e2e/timeline.spec.ts)。

## 要点

- Tiptap / ProseMirror の block action は、見た目 DOM の `> p` / `> h2` 件数より **保存 JSON** と **handle metadata** を優先して確認する。
- autosave は [`app/components/CardModal.tsx`](/Users/yossydie/dev/taesk/app/components/CardModal.tsx) で `2000ms` debounce + `15000ms` max wait のため、E2E は `waitForTimeout` ではなく `expect.poll` を使う。
- menu の keyboard navigation と action 実行は分離して考える。focus/Arrow/Escape の検証と、menu item click による action 実行の検証を分ける方が安定する。
- block menu の初期 focus は `insert-above` 固定ではなく **最初の enabled item** を期待する。
- disabled item は表示されたまま `ArrowUp` / `ArrowDown` / `Home` / `End` で到達できるが、`Enter` / `Space` / click では実行されない。

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

### `move-up` / `move-down`

- top-level block も doc 直下 list item も、target 特定後は **children 配列の並べ替え + `replaceWith(...)`** で安定する。
- 子 `taskList` / `bulletList` / `orderedList` を持つ top-level 親 `taskItem` / `listItem` も、subtree を保持したまま同一 list 内で reorder される前提で検証する。
- nested child `taskItem` / `listItem` も handle 対象に含める。nested item の move は same-parent-list 内に限り、top-level 専用 adjacent list merge に入らないことを確認する。
- shortcut 実行は menu debug を経由しないため、保存 JSON の並び順と autosave 経路で確認する。

### `insert-above` / `insert-below` on nested items

- top-level list item は従来どおり list split + paragraph 挿入で確認する。
- nested `taskItem` / `listItem` は paragraph を list 外へ出さず、同じ親 list に空の sibling item を追加する前提で確認する。
- nested item の保存確認では、追加された node type が `taskItem` / `listItem` のまま維持され、親 list 配下に入っていることを優先して見る。

## 推奨テスト方針

1. `openBlockActionMenu()` で menu 表示と初期 focus を確認する。
2. 先頭/末尾 block では `move-up` / `move-down` の disabled 状態を確認する。
3. keyboard navigation は `ArrowUp` / `ArrowDown` / `Escape` を別テストで確認し、disabled item への roving focus と非実行も確認する。
4. action 実行テストは menu item click を使い、保存 JSON を `expect.poll` で確認する。
5. `Mod-Shift-ArrowUp/Down` の shortcut 実行は menu を開かず、保存 JSON を `expect.poll` で確認する。
6. 末尾空 paragraph が追加されうるため、`> p` の単純件数は補助扱いに留める。
7. nested task の completed hidden run 配下では handle を出さず、run 展開後に handle が復帰することを確認する。

## 検証コマンド

```bash
PW_WORKERS=1 npx playwright test e2e/timeline.spec.ts \
  --grep "supports block actions|updates top-level paragraphs|duplicates heading|disabled move|move paragraph|move details|move list item|move nested task parent|shortcut move|shortcut move nested task parent|supported top-level blocks|pressing Escape closes block menu" \
  --reporter=json > test-results/playwright-block-actions.json
```

レポート確認:

```bash
cat test-results/playwright-block-actions.json | jq '.stats'
```
