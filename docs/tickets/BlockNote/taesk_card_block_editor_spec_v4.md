# taesk: CardModal「ブロックエディター」仕様 v4（BlockNote / 2025-12-20）

> CardModal の入力 UI を Notion/Dynalist 風の **1つのブロックエディター**に統合するための仕様。  
> **保存は onSave 1回のみ**、そのタイミング以外でサーバ更新や副作用を起こさない。

---

## 0. 目的（Goal）

- CardModal の入力 UI を **ブロックエディター 1本**に統合する。
- **先頭ブロック＝タイトル**（空禁止）。
  - `cards.title` は継続利用（一覧・検索・外部連携のため）。
- 本文は BlockNote の **Block JSON（`editor.document`）**を **jsonb** で保存する。
- **保存は onSave 1回で完結**し、そこでのみ副作用（Calendar Sync / Activity Log / Realtime通知）を起こす。

---

## 1. 用語

### 1-1. jsonb
PostgreSQL の JSON格納型。アプリ側は JS のオブジェクトとして送受信できる。

### 1-2. 保存フォーマット
- `content = editor.document`（Block配列）をそのまま保存する（DB は jsonb）。

---

## 2. データ設計（DB）

### 2-1. cards テーブル

- `cards.title` は残す。
- 新カラムを追加（**カラム名に `blocknote` は含めない**）
  - 推奨：`cards.content jsonb NOT NULL DEFAULT '[]'::jsonb`
- 追加で推奨（任意だが便利）
  - `cards.excerpt`：本文から抽出したプレーンテキストを短く保持（OGP/カレンダー説明用）

### 2-2. 既存 checklist の扱い
- `cards.checklist` は段階的に廃止し、最終的に DROP。
- 互換維持しない前提（運用前提）。UI/型/ユーティリティから参照を段階的に削除する。

---

## 3. UI仕様（CardModal）

### 3-1. 表示
- CardModal の**本文入力はブロックエディターのみ**（タイトル/本文/チェックリスト統合）
  - 従来の title input / ChecklistEditor は廃止。
  - 期限・担当・タグ等の他フィールドは対象外（既存UIのまま）

### 3-2. 先頭ブロックからの導出（onSave 時のみ）
- onSave 時に、先頭ブロックから以下を導出して保存する。
  - `title = plainText(firstBlock).trim()`（空なら保存NG）
    - 改行はスペースに置換して 255 文字にクランプ
  - `excerpt = plainText(allBlocksExceptFirst).slice(0, N)`（任意：OGP/カレンダー向け）

### 3-3. 先頭ブロック（タイトル）制約
- 先頭ブロック削除 → 自動で「タイトルブロック」を先頭に挿入
- content が空で開いた場合 → タイトルブロックを 1 行目に挿入
- 先頭に複数ブロック貼り付け → 先頭のみタイトル扱い、残りは本文
- タイトルブロックは **paragraph 固定（checkListItem などは禁止）**
- タイトルブロックは **インデント不可（Tab/Shift+Tab 無効化）**にするのが安全

### 3-4. 未保存ガード（UX）
- `isDirty`（開いた時点の content と比較）を保持
- 閉じる操作（×、Esc、背景クリック、ルーティング）で `isDirty` の場合：
  - 「保存して閉じる / 破棄 / キャンセル」の確認を出す
- 保存中は onSave ボタンを disabled、エラー時はリトライ導線を出す

### 3-5. “入力を失わない”ための安全策（サーバ保存しない代わり）
以下のどちらか（または両方）を推奨：

- **ローカルドラフト**：`localStorage` に `draft:{cardId}` を保存（数秒間隔）
  - onSave 成功で消す
  - 期限（例：7日）で自動破棄
- **クラッシュ復帰**：モーダル再オープン時にドラフトがあれば「復元しますか？」を出す

---

## 4. 保存仕様（API）

### 4-1. 保存トリガー
- **保存は onSave ボタンのみ（原則）**
- 入力中はサーバへ書かない（＝Calendar Sync / Activity Log / Realtime の副作用ゼロ）

### 4-2. onSave の送信内容（1回のリクエストで完結）
`PATCH /cards/:id`（または専用 endpoint）に下記をまとめて送る：

- `content`（Block JSON 全量）
- `title`（先頭ブロックから導出、255文字にクランプ）
- `excerpt`（任意：本文要約。OGP/カレンダーに使う）

ポイント：
- **title を別リクエストにしない**（二重更新＝ログ・同期の増加の元）
- **content だけ更新する “draft API” を作る場合**は「例外扱い」とし、draft 側では副作用禁止

---

## 5. 副作用（Calendar Sync 等）を「onSave 時のみ」にする実装条件

サーバ側で、次のどれかを必須にする：

**A. endpoint 分離（推奨）**
- `PATCH /cards/:id/content`：content/excerpt など“本文系”のみ更新（副作用なし）
- `POST /cards/:id/publish`：onSave で呼ぶ（Calendar Sync / Activity Log / Realtime あり）

**B. フラグ制御**
- onSave 時のみ `triggerCalendarSync: true` を付ける
- サーバは `triggerCalendarSync === true` のときだけ同期する

**C. 差分判定（最小改修）**
- サーバが「**期限（due_*） or title or excerpt が変わった時だけ**」 Calendar Sync を走らせる
- content-only 更新では走らない

---

## 6. DB変更（マイグレーション案）

### 6-1. 追加
```sql
ALTER TABLE cards
  ADD COLUMN content jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 任意（推奨）
-- ALTER TABLE cards ADD COLUMN excerpt text NOT NULL DEFAULT '';
```

### 6-2. checklist 廃止（最終段）
```sql
ALTER TABLE cards DROP COLUMN checklist;
```

### 6-3. 既存データ（titleのみ）をどうする？
- `content` が空なら、title を先頭ブロックに入れた最小ドキュメントを backfill（任意）
- 運用前なら全件リセットでもOK

---

## 7. 段階的実装ステップ（バグらせない）

### Step 0: 下準備
- BlockNote 依存追加（Core系のみ）
- `CardBlockEditor` を単体で動かせる形で作る

### Step 1: DBに新カラム追加（まだUIは変えない）
- `cards.content` 追加（checklist はまだ残す）
- API が `content` を読み書きできるようにする（型/バリデーション/サイズ制限）

### Step 2: CardModal にブロックエディター導入（フラグ付き）
- Feature Flag（例：`cards.blockEditor`）
- フラグON時：
  - content を読み込んで表示
  - **保存は onSave のみ**（入力中はサーバへ送らない）
  - onSave で `content + title (+excerpt)` を一括保存
  - onSave 時のみ Calendar Sync / Activity Log / Realtime
- フラグOFF時：現行UI

### Step 3: checklist の参照をゼロにする
- ChecklistEditor と checklist 表示の導線を削除
- 型・ユーティリティ（flatten/normalize 等）を content 版へ置換
  - 検索：`flattenContentText(content)` を導入（一覧の検索/フィルタ用）

### Step 4: checklist DROP（最終）
- DB から `cards.checklist` を DROP
- migration 適用後に全機能が通ることを確認

---

## 8. テスト観点（最低限）

### 8-1. UI
- 入力 → 閉じる → 未保存警告が出る
- 「保存して閉じる」→ 再オープンで内容が保持
- 保存エラー → 画面内でリトライできる
- ドラフト復元（localStorage 採用時）

### 8-2. サーバ副作用
- 入力中は **Calendar Sync が絶対に走らない**
- onSave 1回で **Calendar Sync が1回だけ**走る
- Activity Log が onSave ごとに1件（必要なら）に抑えられる

### 8-3. データ
- title 空は保存不可
- title 255文字超はクランプ（サーバ/クライアント双方）
- content が巨大化しない（サイズ上限・画像等は非スコープ）

---

## 9. 非スコープ（今回やらない）
- 画像/埋め込み/ファイル添付など高度ブロック
- 協調編集
- Markdown を正として保存（lossy になり得るため）
