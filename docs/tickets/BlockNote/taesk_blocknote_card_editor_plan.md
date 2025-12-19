# taesk: CardModal「ブロックエディター」(BlockNote) 導入計画（Dynalist / Notion風チェックリスト）

## 0. ねらい（結論）
- CardModal の入力UIを「タイトル + チェックリスト」から、**1つのブロックエディター**へ統合する。
- Notion/Dynalistのように **Enterで項目追加 / Tabでネスト / チェック切替** を自然に行える“キモ”を、**自前実装ではなく BlockNote で担保**する。
- DBスキーマ（`title` / `checked` / `checklist(jsonb)`）は維持し、**表示だけ統合**する。

---

## 1. 現状（リポジトリ調査メモ）
### 1-1. チェックリストは「独自実装」
- `lib/checklist.ts` に `ChecklistLine`（`id`, `level`, `checked`, `text`）や正規化・制限（最大行数/文字数）などのロジックがあり、DBは **jsonbで保存**される前提。
- `ChecklistEditor.tsx` は TipTap 等ではなく、1行ごとの入力・キー操作をハンドリングする **カスタム実装**。

### 1-2. CardModal は `ChecklistEditor` を使っている
- `app/(board)/_components/CardModal.tsx` で `ChecklistEditor` をimportし、`onChecklistCommit` 経由で checklist の更新を受けている。

### 1-3. TipTap は「コメント（mentions）側」で既に利用
- `CommentEditor.tsx` / `Mention.ts` / `MentionSuggestion.tsx` など、コメント編集とメンションに TipTap を導入済み。
- `lib/mention-utils.ts` は “TipTap・BlockNote等のエディタと共通利用可能” を意図した設計になっている（BlockNote移行を想定）。

---

## 2. 技術方針（なぜ BlockNote か / なぜ TipTap単体ではないか）
### 2-1. BlockNote採用理由
- BlockNoteは「NotionっぽいブロックUI」を提供し、**ブロックの並び・ネスト・キーボード操作の基本体験**が最初から揃っている。
- Checklist（チェック付きリスト）もブロックとして扱えるため、今回の「アウトライナー体験」を作りやすい。

### 2-2. TipTap単体でやる場合の主なコスト
- `taskList`/`taskItem` で“見た目”は作れるが、**Dynalist/Notionの体験に寄せるための細かい挙動**（Enter/Backspace/Tab/カーソル移動/範囲選択/折りたたみ等）を作り込むのが重い。
- 「1行目=タイトル（特別扱い）」の制約も、TipTapだと結局かなりのガードロジックが必要。

---

## 3. ライセンス方針（無料 / コア機能のみ）
- **BlockNote Core（MPL-2.0）だけを利用**する。  
  - `@blocknote/core`, `@blocknote/react`（必要なら `@blocknote/mantine` 等の“Core系”）
- **BlockNote XL / Pro系（GPLや商用条件が絡むもの）は依存に入れない**。  
- 追加要件（協調編集/AI/高度なエクスポート等）が将来必要になったら、別途「ライセンス含む」判断を切り出す。

---

## 4. UX仕様（CardModal内の編集体験）
### 4-1. 基本仕様
- エディターは **1つ**。
- **最初のブロック = タイトル行（チェック可能）**  
  - チェック状態は `card.checked`
  - 見た目はタイトル相当（太字/サイズ大）に寄せる（CSSでスタイル付与 or カスタムBlock）
- **2つ目以降のブロック = checklist項目**
  - Tab / Shift+Tab で階層（level）を作る
  - チェックのOn/Offをサポート

### 4-2. 重要な制約（データ互換）
- UIはBlockNoteの単一ドキュメントとして編集するが、DBは引き続き `title` / `checked` / `checklist` を保持する。
  - 連携・一覧・検索のため `title` は維持する（例: Googleカレンダー同期の summary）。 :contentReference[oaicite:0]{index=0}
- 保存時にエディタ内容を分解して永続化する：
  - 先頭ブロック → `title`, `checked`
  - 残りブロック → `checklist.lines`
- 先頭ブロックが「空になる / 削除される / タイトルとして解釈できない状態」になった場合は自動補正する（下記「ガード」参照）。

### 4-3. ガード（壊れやすいケース対策）
- ドキュメント先頭が空になったら、必ず「タイトルブロック」を自動挿入する。
- タイトルブロックはインデント不可（Tab/Shift+Tabを無効化）とし、常に先頭に固定する。
- 先頭ブロックがタイトルとして解釈できない形（例: 空、複数ブロック貼り付けで先頭が崩れる等）になった場合、
  - 先頭ブロックをタイトルブロックへ自動修復し、
  - タイトルに入らなかった分は2ブロック目以降（チェックリスト側）へ寄せる。

---

## 5. データ変換（DB ⇄ BlockNote）
### 5-1. Load: DB → Editor Blocks
入力：`title: string`, `checked: boolean`, `checklist: { version, lines: ChecklistLine[] }`

出力：BlockNoteの `Block[]`

- Block[0]（タイトル）:
  - type: `checkListItem`（またはカスタム title block）
  - checked = `card.checked`
  - content = `card.title`
- Block[1..]（チェックリスト）:
  - `checkListItem` を生成
  - `ChecklistLine.level` を BlockNoteの階層（children）へ変換

### 5-2. Save: Editor Blocks → DB
- Block[0] → `title`, `checked`
- Block[1..] → `ChecklistLine[]`
  - BlockNoteの階層（children）を再帰的にフラット化して `level` を復元
- **テキストはプレーンテキストで保存**する（初期はリッチテキストを保存しない）
  - 書式（bold/link等）を保存しない前提なので、UI側も「装飾は基本オフ」にする

---

## 6. 実装タスク（変更ファイル案）
### 6-1. 依存追加（package.json）
- `@blocknote/core`
- `@blocknote/react`
- （必要なら）`@blocknote/mantine` + UI依存（ただし“Core系”に限定）

### 6-2. 新規コンポーネント
`app/(board)/_components/checklist/CardBlockEditor.tsx`（仮）
- `use client`
- props:
  - `title`, `checked`, `checklist`
  - `onChange({ title, checked, checklist })`
- 内部：
  - `cardToBlocks()` / `blocksToCard()` の変換関数を実装
  - `onChange` で保存用データに変換して親へ返す（debounce可）

### 6-3. 既存置き換え
`app/(board)/_components/CardModal.tsx`
- `input (title)` と `ChecklistEditor` を `CardBlockEditor` に置換
- 既存の `ChecklistPreview` / 一覧表示は、DBフォーマット維持のため基本そのまま

### 6-4. Feature Flag（推奨）
- 既存の `mentions.richEditor` のように、`cards.blockEditor` などを追加して段階リリース
  - flag on: BlockNote
  - flag off: 既存UI（タイトル + ChecklistEditor）

---

## 7. テスト計画
### 7-1. 自動テスト（ユニット）
- `cardToBlocks()` / `blocksToCard()` の変換テスト
  - ネスト（level）保持
  - 先頭ブロック分離
  - 空/異常入力のガード挙動

### 7-2. E2E（Playwright）
- CardModalで以下を実施
  - 先頭ブロック編集 → titleに反映
  - Enterで次行がチェック項目として増える
  - Tab/Shift+Tabでネストが保存される
  - チェックOn/Offが保存される
  - リロードで永続化

---

## 8. リスクと対策
- **ライセンス事故（XL/Pro混入）**
  - package追加時に依存ツリーを確認し、Coreのみで固定する。
- **バンドルサイズ/SSR**
  - CardModal表示時のみ dynamic import する（初期ロードを軽くする）。
- **プレーンテキスト保存とUIのズレ**
  - 書式ツールバー/ショートカットを極力無効化し、「見た目を変えられない」体験に寄せる。
- **“タイトル行だけ特別”の一貫性**
  - 保存時ガード + 編集時の軽い自動修復で破綻を防ぐ。

---

## 9. 非スコープ（今回やらない）
- リッチテキストの永続化（BlockNoteのdocument JSON保存等）
- 画像/ファイル/埋め込みブロック
- 協調編集
- コメントエディタ（TipTap）をBlockNoteへ統合（別チケット）
