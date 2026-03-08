# Keyboard Navigation

CardModal のタイトル入力欄と本文先頭ブロックの境界で使えるキー操作を整理する。対象実装は [app/components/CardModal.tsx](../../app/components/CardModal.tsx) と [app/(board)/_components/tiptap/TiptapEditor.tsx](../../app/(board)/_components/tiptap/TiptapEditor.tsx)。

## 対象範囲

- 対象 UI は Timeline の CardModal
- 対象の境界は「タイトル入力欄」と「本文の先頭テキストブロック」
- 本文の先頭ブロックは top-level `paragraph` だけでなく `taskList > taskItem > paragraph` も含む

## タイトル側のキー操作

| キー | 条件 | 挙動 |
| --- | --- | --- |
| `ArrowDown` | タイトルでキャレット選択のみ | 本文先頭ブロックの同じ桁へ移動 |
| `ArrowRight` | タイトル末尾 | 本文先頭ブロックの先頭へ移動 |
| `Enter` | タイトルでキャレット選択のみ | タイトルをキャレット位置で分割し、右側を本文先頭に `paragraph` として挿入 |
| `Delete` | タイトル末尾、かつ本文先頭が top-level の plain `paragraph` | 先頭 paragraph の文字列をタイトル末尾へマージ |

## 本文側のキー操作

| キー | 条件 | 挙動 |
| --- | --- | --- |
| `ArrowUp` | 本文の先頭テキスト行 | タイトルの同じ桁へ移動 |
| `ArrowLeft` | 本文の先頭テキスト行かつ行頭 | タイトル末尾へ移動 |
| `Backspace` | 本文先頭、かつ先頭ブロックが top-level の plain `paragraph` | 先頭 paragraph の文字列をタイトル末尾へマージ |

## 実装上の注意

- `ArrowUp` / `ArrowLeft` は「doc 先頭から辿れる最初のテキストブロック」を基準に判定する
- そのため、新規カードの初期本文である `taskList > taskItem > paragraph` でも上下左右の境界移動が動作する
- `ArrowUp` は本文スクロール領域が存在しない短いカードでもタイトルへ戻る
- `Delete` / `Backspace` によるマージは、チェックリスト先頭行には適用しない
  - 先頭が `taskList` の場合はテキストだけを安全に抽出してマージできないため、現状は非対応
  - 新規カードのデフォルト本文は checklist なので、このマージ系ショートカットは通常は発火しない

## 回帰テスト

- [e2e/timeline.spec.ts](../../e2e/timeline.spec.ts)
  - task-list 先頭カードでの `ArrowDown` / `ArrowUp`
  - task-list 先頭カードでの `ArrowRight` / `ArrowLeft`
  - plain paragraph 先頭カードでの `Enter`
  - plain paragraph 先頭カードでの `Delete` / `Backspace`
