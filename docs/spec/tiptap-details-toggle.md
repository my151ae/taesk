# Tiptap Details / Toggle Specification

CardModal 本文エディタにおける `details`（トグル）機能の仕様をまとめる。対象実装は [app/(board)/_components/tiptap/TiptapEditor.tsx](/Users/yossydie/dev/taesk/app/(board)/_components/tiptap/TiptapEditor.tsx) と [app/components/CardModal.tsx](/Users/yossydie/dev/taesk/app/components/CardModal.tsx)。

## 1. 対象範囲

- 対象 UI は Timeline の CardModal 本文エディタのみ
- `details` は Tiptap の `@tiptap/extension-details` を利用する
- `/b/...` の Timeline/CardModal を正とし、Kanban 画面や別 editor は対象外

## 2. 責務境界

- `CardModal`
  - タイトル入力、autosave、履歴プレビュー、本文エディタのマウント管理を担当する
  - 本文構造変換は担当しない
- `TiptapEditor`
  - `details` の作成・解除、block handle、block menu を担当する
  - `toggle-details` / `unset-details` の実行後は autosave 経路へ確実に変更を流す

この機能の原則は「本文構造の変更責務を上位コンポーネントに持ち上げない」こと。

## 3. 現在の操作仕様

### 3-1. トグル化

- 通常 block の行メニューから `トグルに変換` を実行する
- 対象は以下
  - top-level `paragraph`
  - top-level `heading`
  - top-level `taskItem`
- 実行結果
  - 対象 block を `details` に包む
  - `detailsSummary` は空で開始する
  - 元 block は `detailsContent` に移る

### 3-2. トグル解除

- `details` の summary 行メニューから `トグル解除` を実行する
- 実行結果
  - `detailsSummary` の内容と `detailsContent` の内容を通常 block 列へ戻す
  - 解除後に `details` ノードは消える

### 3-3. 専用ボタン

- CardModal 上部の `トグル` / `トグル解除` ボタンは廃止済み
- トグル操作の正規導線は block menu のみ

## 4. Handle / Menu の表示ルール

- 通常 block には従来どおり block handle を表示する
- `details` では summary 行にのみ handle を表示する
- `detailsContent` 内の段落・見出し・task は独立した handle 対象にしない
- move の対象は同一コンテナ内に限る
  - top-level `paragraph` / `heading` / `details`
  - `doc` 直下 `taskList` / `bulletList` / `orderedList` 内の top-level `taskItem` / `listItem`
  - 上記 item は子 `taskList` / `bulletList` / `orderedList` を持っていても対象に含む
  - move は item 単体ではなく、配下 subtree を保持したまま sibling 順序を入れ替える
- nested child の `taskItem` / `listItem` は引き続き handle / move 対象に含めない
- `detailsContent` 内 block、list をまたぐ移動、indent / outdent を伴う階層変更、drag & drop は対象外
- menu 項目は target type ごとに切り替える
- menu open 直後の初期 focus は「最初の enabled item」
- disabled item は menu 上に表示し、roving focus では到達可能だが実行はできない

| block type | 表示する menu |
| --- | --- |
| `paragraph` / `heading` / `taskItem` / `listItem` | `move-up`, `move-down`, `insert-above`, `insert-below`, `toggle-details`, `duplicate`, `delete` |
| `details` | `move-up`, `move-down`, `unset-details` |

## 5. 保存仕様

- `CardModal` の autosave は `2000ms` debounce + `15000ms` max wait
- `details` の変換・解除は、Tiptap の内部更新だけでなく `onChange` を直接流して autosave 経路へ確実に載せる
- そのため「トグル変換だけを行い、その後に追加入力しない」ケースでも保存対象になる

### 保存確認の考え方

- DOM 見た目より保存 JSON を優先する
- `details` 化直後は補助 paragraph が残ることがあるため、top-level が `['details']` に厳密一致するとは限らない
- 仕様確認では「top-level に `details` が含まれるか」をまず見る

## 6. キーボード挙動

- タイトル/本文境界のキーボード責務は [docs/spec/keyboard-navigation.md](/Users/yossydie/dev/taesk/docs/spec/keyboard-navigation.md) を正とする
- `details` 内部の Enter / Backspace / Arrow 補正は本文内部挙動として扱う
- title から本文への `ArrowDown` / `ArrowRight` と、本文先頭から title へ戻る `ArrowUp` / `ArrowLeft` は `details` 導入後も変えない

## 7. テスト観点

- block menu の検証方針は [docs/spec/tiptap-block-action-testing.md](/Users/yossydie/dev/taesk/docs/spec/tiptap-block-action-testing.md) を正とする
- `details` では最低限以下を確認する
  - 通常行から `toggle-details` で `details` が保存される
  - 空 summary + 既存 block の `detailsContent` 包装が維持される
  - summary 行の handle から `unset-details` が動く
  - top-level `details` が `move-up` / `move-down` で同一コンテナ内を移動できる
  - `details` 解除後に summary/content が消えずに通常 block へ戻る

## 8. 今後の拡張ポイント

今後トグル周りに機能を増やす場合は、このファイルを SSOT として更新する。特に以下は追加仕様が入りやすい。

- summary 行の placeholder / 初期フォーカス位置
- `detailsContent` 内 block の個別操作許可範囲
- nested `details` の許可/禁止
- block menu 内での item 並び順・ショートカット
- 解除時の block 正規化ルール
- 保存 JSON の末尾補助 paragraph を許容するかどうか
