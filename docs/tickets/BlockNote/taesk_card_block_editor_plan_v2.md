# taesk: CardModal「Notion風ブロックエディター」導入計画（BlockNote採用 / 2025-12-18 改訂）

> この改訂版は、あなたの要望に合わせて  
> - **既存 checklist は破棄（過去データ含め運用前なので問題なし）**  
> - **BlockNote の Document(JSON) を新カラムに保存（カラム名に `blocknote` は使わない）**  
> - **title カラムは継続利用（先頭ブロックから導出・空禁止）**  
> - **モーダルはブロックエディター1本化 + 入力で自動保存（debounce）**  
> を前提に書き直したものです。

---

## 0. ゴール（結論）
- CardModal の入力 UI を **「Notion/Dynalist風の1つのブロックエディター」**に統合する。
- **先頭ブロックをタイトルとして扱い、空文字は禁止**（= title カラムの品質を保つ）。
- エディターの内容は **BlockNote 推奨の Block JSON（`editor.document`）**をそのまま DB に保存し、**入力に合わせて自動保存**する。
- 既存の `checklist(jsonb)` は削除し、BlockNote 側へ寄せる（過去データも破棄でOK）。

---

## 1. 用語整理
### 1-1. jsonb とは？
- Supabase(PostgreSQL) の **JSON格納型**で、文字列JSONではなく **JSONとして高速に保存・検索・インデックス可能**な型。
- アプリ側では `JSON.stringify(...)` / `JSON.parse(...)` 相当で扱える（型はDBが jsonb）。

### 1-2. 保存フォーマット
- 保存は **BlockNote 推奨**：`editor.document`（Block配列）を **そのまま JSON として保存**する。  
  - 例：`content = editor.document` を PATCH で送る（DBは jsonb）。

---

## 2. 方針（DB / API / UI の設計）
### 2-1. DB方針
- **`cards.title` は残す**（一覧・検索・外部連携・表示互換のため）。
- BlockNote のドキュメントを保存する **新カラム**を追加する（※カラム名に `blocknote` は含めない）。
  - 推奨カラム名案（どれか1つに統一）
    - `cards.content`（最も無難）
    - `cards.document`（意味が明確）
    - `cards.editor_doc`（用途が明確）
- 既存の `cards.checklist` は最終的に **DROP** する（運用前のため過去データは破棄でOK）。

### 2-2. UI方針（CardModal）
- CardModal は **ブロックエディターのみ表示**（title input / ChecklistEditor を廃止）。
- **先頭ブロックをタイトル**として扱う  
  - テキスト：`title = plainText(firstBlock)`（trimして空なら保存NG）
  - チェック状態：`checked = firstBlock.props.checked`（先頭ブロックを checkListItem として運用する場合）
- それ以外のブロックは “本文” として `content`（新カラム）へ保存（先頭ブロックも含めて丸ごと保存してOK）

> 重要：DB には `title` と `content` を **両方**保存する。  
> `title` は “検索・一覧・外部連携” 用の冗長キャッシュ、`content` が真の本文。

### 2-3. 既存 checklist の扱い
- 互換維持はしない（運用前なので **削除前提**）。
- 移行期間中に安全のため残す場合でも、表示・編集はしない（段階移行のための“退避”扱い）。

---

## 3. 自動保存の仕様（「入力時に保存される？」への回答）
BlockNote自体が勝手にDB保存するわけではなく、**アプリ側で onChange を拾って API 保存**します。

### 3-1. 自動保存（推奨）
- エディター変更（入力/チェック/ブロック操作）を検知
- **debounce（例: 400〜800ms）**して `PATCH /cards/:id` を呼ぶ
- UI には「Saving… / Saved / Error」などの状態表示を出す（小さくでOK）

### 3-2. 保存トリガーの例
- `useEffect + setTimeout` の debounce
- 連打対策：
  - 直前のリクエストを AbortController でキャンセル
  - もしくは単純に「最後に発火したものだけ採用（last-write-wins）」でもOK

### 3-3. タイトル空禁止ガード
- 保存直前に `title.trim().length > 0` を必須にする
- 空なら
  - 保存しない（エラー表示）
  - 先頭ブロックにフォーカスを戻す
  - プレースホルダ表示（例: 「タイトルを入力」）

---

## 4. 仕様詳細（先頭ブロックの特別扱い）
### 4-1. 先頭ブロックが壊れるケースへの対策
- 先頭ブロック削除 → 自動で “タイトルブロック” を先頭に挿入
- 先頭に複数ブロック貼り付け → 先頭のみタイトル扱い、残りは本文側へ
- タイトルブロックは **インデント不可**（Tab/Shift+Tab 無効化）にするのが安全

### 4-2. ブロック型の選択
- 最小構成：先頭も含めて **標準 block（paragraph or checkListItem）**で運用し、先頭だけ CSS で大きく/太字
- 理想：カスタム “Title block（checkbox付き）” を定義（将来拡張しやすい）

---

## 5. DB変更案（マイグレーション）
> 実装は段階的にする（次章）ので、ここでは最終形のスキーマを示す。

### 5-1. 追加
- `ALTER TABLE cards ADD COLUMN content jsonb NOT NULL DEFAULT '[]'::jsonb;`
  - ※ カラム名は `content` を推奨（ただしチームの命名規約に合わせる）

### 5-2. 削除（運用前のため破棄OK）
- `ALTER TABLE cards DROP COLUMN checklist;`

### 5-3. 既存データ（titleのみ）はどうする？
- 既存カードの `content` が空の場合は、以下の最小ドキュメントを生成して埋める：
  - 先頭ブロック：title を content に入れる
  - 2ブロック目以降：空
- 運用前なら「全件リセット」でもOK（ただし開発中の確認用データが必要なら backfill 推奨）

---

## 6. 段階的実装ステップ（バグらせないための進め方）
### Step 0: 下準備（最小リスク）
- [ ] BlockNote 依存追加（Core系のみ）
- [ ] 新コンポーネント `CardBlockEditor`（仮）を作成（Modal外でStory的に単体動作確認）

### Step 1: DBに新カラム追加（まだUIは変えない）
- [ ] `cards.content(jsonb)` を追加（※ checklist はまだ残す）
- [ ] API が `content` を読み書きできるようにする（型 / バリデーション）

### Step 2: CardModalにブロックエディターを導入（フラグ付き）
- [ ] Feature Flag（例: `cards.blockEditor`）で切り替え
- [ ] フラグON時：
  - `content` を読み込んで BlockNote 表示
  - 変更で debounce 自動保存（PATCH）
  - `title` は先頭ブロックから導出して一緒に保存
- [ ] フラグOFF時：現行UIのまま（比較できる）

### Step 3: 既存 checklist を完全停止
- [ ] ChecklistEditor / checklist表示の導線を削除（UI/型/ユーティリティ整理）
- [ ] `checklist` を参照している箇所がないことを確認

### Step 4: DBから checklist をDROP（最終）
- [ ] `cards.checklist` をDROP
- [ ] migration適用後に型・API・UIが全部通ることを確認

---

## 7. テスト観点（最低限）
### 7-1. ユニット（変換/ガード）
- [ ] 先頭ブロックが空 → 保存しない
- [ ] 先頭ブロック削除 → 自動挿入される
- [ ] 貼り付けで先頭が崩れても title を維持できる

### 7-2. E2E（Playwright）
- [ ] CardModalを開く → ブロックエディターが表示される
- [ ] 入力 → 数百ms後に自動保存 → リロードして保持
- [ ] 先頭のチェック切替 → `cards.checked` に反映
- [ ] エラー時（ネットワーク） → UIで分かる

---

## 8. 非スコープ（今回やらない）
- 画像/埋め込み/ファイル添付など高度なブロック
- 協調編集
- Markdown を正としての保存（lossyになる可能性があるため）

---

## 9. 変更点まとめ（改訂版の要点）
- checklist は破棄（運用前なのでOK）
- 新カラム（`content` 推奨）に Block JSON を保存
- title は先頭ブロックから導出・空禁止
- CardModalは “Notion風ブロックエディターだけ” を表示
- 入力に応じて自動保存（debounce）
