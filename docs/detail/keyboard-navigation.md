# Keyboard Navigation

CardModal のタイトル入力欄と本文先頭ブロックの境界で使えるキー操作を整理する。対象実装は [app/components/CardModal.tsx](../../app/components/CardModal.tsx) と [app/(board)/_components/tiptap/TiptapEditor.tsx](../../app/(board)/_components/tiptap/TiptapEditor.tsx)。

## 対象範囲

- 対象 UI は Timeline の CardModal
- 対象の境界は「タイトル入力欄」と「本文の先頭テキストブロック」
- 本文の先頭ブロックは top-level `paragraph` だけでなく `taskList > taskItem > paragraph` も含む
- この境界は「フォーカス移動のみ」を責務とし、タイトル/本文の構造変換は扱わない

## タイトル側のキー操作

| キー | 条件 | 挙動 |
| --- | --- | --- |
| `ArrowDown` | タイトルでキャレット選択のみ | 本文先頭ブロックの同じ桁へ移動 |
| `ArrowRight` | タイトル末尾 | 本文先頭ブロックの先頭へ移動 |

## 本文側のキー操作

| キー | 条件 | 挙動 |
| --- | --- | --- |
| `ArrowUp` | 本文の先頭テキスト行 | タイトルの同じ桁へ移動 |
| `ArrowLeft` | 本文の先頭テキスト行かつ行頭 | タイトル末尾へ移動 |

## 実装上の注意

- `ArrowUp` / `ArrowLeft` は「doc 先頭から辿れる最初のテキストブロック」を基準に判定する
- そのため、新規カードの初期本文である `taskList > taskItem > paragraph` でも上下左右の境界移動が動作する
- `ArrowUp` は本文スクロール領域が存在しない短いカードでもタイトルへ戻る
- タイトル欄の paste はブラウザ標準動作に任せる。複数行テキストも `input` の通常挙動に従い、タイトル/本文へ分解しない
- タイトル欄から本文への画像 paste 転送は行わない。画像 paste は本文エディタ側だけが扱う
- タイトル/本文の相互変換 (`Enter` 分割、`Delete` / `Backspace` 結合) は持たない

## 回帰テスト

- [e2e/timeline.spec.ts](../../e2e/timeline.spec.ts)
  - task-list 先頭カードでの `ArrowDown` / `ArrowUp`
  - task-list 先頭カードでの `ArrowRight` / `ArrowLeft`
