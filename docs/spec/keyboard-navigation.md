# Keyboard Navigation

CardModal のタイトル入力欄と本文エディタのキーボード責務を整理する。対象実装は [app/components/CardModal.tsx](../../app/components/CardModal.tsx) と [app/(board)/_components/tiptap/TiptapEditor.tsx](../../app/(board)/_components/tiptap/TiptapEditor.tsx)。

## 対象範囲

- 対象 UI は Timeline の CardModal
- タイトル入力欄と本文エディタの間に、矢印キーによるフォーカスブリッジを持つ
- タイトル/本文の構造変換は扱わない

## タイトル側

- `ArrowDown` は本文の先頭テキストブロックへ同じ桁で移動する
- `ArrowRight` はタイトル末尾から本文先頭へ移動する
- `Enter` は IME 確定中を除き、本文1行目へ標準 paragraph を1つ追加してその段落へフォーカス移動する
- タイトル欄から本文への画像 paste 転送は行わない

## 本文側

- 本文の先頭テキスト行で `ArrowUp` を押すとタイトルへ同じ桁で戻る
- 本文の先頭テキスト行かつ行頭で `ArrowLeft` を押すとタイトル末尾へ戻る
- 本文の先頭テキスト行かつ行頭で `Backspace` を押すと、先頭が空の top-level paragraph の場合だけその paragraph を削除してタイトル末尾へ戻る。それ以外は本文を変更せずタイトル末尾へ戻る
- 本文エディタ内部のキー挙動だけを扱う
- `details` 内部の Enter / Backspace / Arrow 補正は本文内部挙動として扱う
- `ArrowUp` / `ArrowDown` のスクロール補正や block move shortcut は本文内部責務に含む

## 回帰テスト

- [e2e/timeline.spec.ts](../../e2e/timeline.spec.ts)
  - タイトル欄で `ArrowDown` を押すと本文へ移る
  - 本文先頭で `ArrowUp` を押すとタイトルへ戻る
  - タイトル末尾で `ArrowRight` を押すと本文先頭へ移る
  - 本文先頭行頭で `ArrowLeft` を押すとタイトル末尾へ戻る
  - 本文先頭行頭で `Backspace` を押すと、空の top-level paragraph だけ削除してタイトル末尾へ戻る
  - 本文先頭行頭で `Backspace` を押しても、非空行や list/details 先頭では本文は変えずタイトル末尾へ戻る
  - タイトル欄で通常の `Enter` を押すと本文1行目に paragraph が追加され本文へ移る
  - タイトル欄で IME 確定中の `Enter` を押しても本文へ移らない
  - modal shortcut bar が title/body それぞれの文脈に追従する
