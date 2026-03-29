# Keyboard Navigation

CardModal のタイトル入力欄と本文エディタのキーボード責務を整理する。対象実装は [app/components/CardModal.tsx](../../app/components/CardModal.tsx) と [app/(board)/_components/tiptap/TiptapEditor.tsx](../../app/(board)/_components/tiptap/TiptapEditor.tsx)。

## 対象範囲

- 対象 UI は Timeline の CardModal
- タイトル入力欄と本文エディタの間に、専用のフォーカスブリッジは持たない
- タイトル/本文の構造変換は扱わない

## タイトル側

- `Enter` は改行・境界移動・構造変換を行わない
- タイトル欄から本文への画像 paste 転送は行わない

## 本文側

- 本文エディタ内部のキー挙動だけを扱う
- `details` 内部の Enter / Backspace / Arrow 補正は本文内部挙動として扱う
- `ArrowUp` / `ArrowDown` のスクロール補正や block move shortcut は本文内部責務に含む

## 回帰テスト

- [e2e/timeline.spec.ts](../../e2e/timeline.spec.ts)
  - タイトル欄で `Enter` を押しても本文へ移らない
  - modal shortcut bar が title/body それぞれの文脈に追従する
