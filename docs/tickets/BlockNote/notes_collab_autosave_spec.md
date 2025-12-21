# Notes 共同編集（推奨案A）設計（後からYjsへ移行可能にする前提）

作成者: 松本Ops  
目的: Notes（Cardのメモ）編集体験を **Notion / Google Docsに近い体感**へ寄せつつ、Supabase（Postgres + Realtime）で **負荷とコストを抑えて** “最大3名程度の同時参加” を成立させる。  
前提: 最初は **推奨案A（ソフトロック + 低遅延プレビュー + バッチ永続保存）**で実装し、将来必要になったら **Yjs（CRDT）を段階導入**できるよう境界を作る。

---

## 1. 要件整理

### 1.1 目標（Must）
- 同じカードの Notes を **最大3名程度**が同時に開ける
- **編集内容が（できれば）リアルタイムに見える**
- 保存確認（破棄）ダイアログの誤表示（Dirty誤判定）を抑止
- ネットワークやDB負荷を上げすぎずにスムーズに動く

### 1.2 目標（Should）
- オフライン/一時切断でも **下書きが復元できる**
- 編集中のユーザー（Presence）が分かる
- “誰が編集権を持っているか” がUIで明確

### 1.3 非目標（Not now）
- Google Docs級の「完全同時編集（全員が同時に打っても自動マージ）」  
  → これは後からYjs導入で狙う

---

## 2. 全体方針（推奨案A）

**3レイヤーで責務分離**する：

1) **ローカル（体感）**  
   - 入力反映は即時  
   - 300〜500ms debounceで「下書き保存（端末内）」  
   - Dirty判定は“正規化差分”を排除した上で正確に

2) **共同編集の見える化（低遅延配信）**  
   - Supabase Realtimeの **Broadcast / Presence** を使い、
     - Presence: 誰が開いてる/編集してるか
     - Broadcast: 編集ドラフト（preview）を **~200ms程度**で配信（スロットル）
   - DBへの永続保存とは分離

3) **永続保存（DB更新）**  
   - 1〜3sデバウンス + maxWait（例: 10s）で間引いて更新
   - 画面離脱/明示保存/blur で即フラッシュ
   - できる限り「同一カード・同一フィールドは最後の更新だけ残す」

---

## 3. データモデル / チャンネル設計

### 3.1 Realtime Channel naming
- Card単位: `realtime:card:{cardId}`
  - Presence: `card:{cardId}:presence`
  - Broadcast: `card:{cardId}:draft`
- Board単位（既存の購読があるなら温存）: `realtime:board:{boardId}`  
  - 既存の `postgres_changes` の購読は **永続保存の最終反映**として使う

### 3.2 Presence state（例）
```json
{
  "userId": "uuid",
  "displayName": "松本Ops",
  "mode": "editor | viewer",
  "lastActiveAt": 1730000000000
}
```

### 3.3 Broadcast message schema（例）
**イベントタイプは将来Yjsに差し替え可能なように “transport層” を固定化**する。

#### (A) Draft preview（推奨）
- イベント名: `notes:draft`
- Payload例（最小）:
```json
{
  "cardId": "uuid",
  "rev": 12,
  "fullText": "<serialized notes>",
  "sentAt": 1730000000000
}
```

> まずは実装簡単な `fullText` で開始してOK。  
> 後から最適化したくなったら `delta` や `ops` に変更できる（受信側がrevで整合性を取る）。

#### (B) Cursor/selection（任意）
- イベント名: `notes:cursor`
- Payload:
```json
{ "cardId":"uuid", "userId":"uuid", "cursor": { "anchor": 10, "head": 12 } }
```

---

## 4. ソフトロック（編集権）仕様

### 4.1 基本
- **編集権（editor）は原則1名**、他のユーザーは viewer として参加し、編集内容をリアルタイムに閲覧できる
- 編集権が必要な場合は「Take over」ボタンで奪取（合意/警告あり）

### 4.2 実装オプション
#### Option 1: Presenceベース（最小実装）
- 最初に `mode=editor` でPresence joinした人を editor とする
- editor離脱（disconnect）したら次の参加者が editor になれる

**メリット:** 実装が軽い  
**デメリット:** ネットワーク分断時に“幽霊editor”が残りやすい

#### Option 2: DBロックテーブル + TTL（推奨）
- `card_edit_locks` テーブル（1カード1行）
  - `card_id (PK)`, `user_id`, `expires_at`, `updated_at`
- editor取得:
  - `upsert` しつつ、`expires_at < now()` のときのみ奪取OK
  - TTL 例: 30秒（presence heartbeatで延長）
- UIはpresenceを表示しつつ、編集権の最終判定はDB

**メリット:** “幽霊editor”対策に強い  
**デメリット:** 実装は少し重い（RLS/関数が必要）

> まずは Option 1 で開始しても良いが、3名同時利用が前提なら Option 2 を推奨。

---

## 5. オートセーブ仕様（ローカル / 配信 / 永続化）

### 5.1 ローカル下書き保存
- 保存先: IndexedDB（推奨）または localStorage
- key: `draft:card:{cardId}:notes`
- タイミング: **300〜500ms debounce**
- 内容: editorのシリアライズ結果（BlockNote/JSONなど）

復元:
- カードを開いたとき
  - サーバ最新版よりローカルが新しければ「下書きを復元しますか？」を出す（任意）
  - 自動復元する場合はUIに「ローカル下書き復元」トースト

### 5.2 共同編集プレビュー配信（Broadcast）
- タイミング: **~200msスロットル**（入力が続く間、最大5回/秒程度）
- editorのみ送信
- viewerは受信してプレビュー更新
- viewerが同時に編集しようとした場合:
  - その場で editor 奪取フローへ誘導（ソフトロック）

### 5.3 永続保存（DB更新）
- タイミング: **1〜3秒デバウンス + maxWait 10秒**
- 画面操作で即フラッシュ:
  - Saveボタン
  - blur（フォーカスアウト）
  - モーダルclose（ただし“保存中”ならローディング→完了まで待つUI）
- “同一カード・同一フィールド”は **最後の更新だけ**に畳む
  - 既存の syncQueue があるなら idempotencyKey を `card:{cardId}:notes` に固定して上書き方式

---

## 6. Dirty判定（破棄ダイアログ）改善

### 6.1 何が問題か
- editor初期マウント時の正規化（タイトル行追加など）で onChange が発火し、ユーザーが何も触っていないのに dirty になる

### 6.2 対策
- 初期値生成時に editor側の正規化と同じ処理を通す（例: ensureTitleBlock）
- mount直後の onChange を抑止（既存の suppressOnChangeRef を強化）
- DB保存完了後に「サーバ反映済みの内容」とローカル内容が一致したら dirty を false に戻す

---

## 7. 競合・整合性

### 7.1 推奨案A（ソフトロック）での競合
- 原則 editor が1人なので、同時編集によるマージ問題は起きにくい
- viewerが奪取した場合:
  - 旧editorに警告表示（編集権が移りました）
  - 旧editorの未保存ドラフトはローカルに残し、必要なら差分表示して手動マージ

### 7.2 永続保存の整合性
- DB更新は `rev`（クライアント生成でも可）を持ち、古いrevの更新を拒否/無視できると安全
- まずは最小で `updated_at` を利用し、サーバが新しい方を正として返す

---

## 8. パフォーマンス/コスト観点（指針）

- “編集プレビュー”は Broadcast（軽い）で流し、DB更新を刻まない  
- DB更新は 1〜3秒に間引く（長文だとpayloadも増えるため）
- Postgres Changes（DB購読）は **最終反映**として使う（頻度が上がると負荷要因になりやすい）

---

## 9. テレメトリ（最低限）

- autosave enqueue 回数 / flush 回数
- flush 1回あたりの保存時間（p50/p95）
- broadcast 送信頻度（msg/sec）
- editor奪取回数（Take over）
- 保存エラー率（ネットワーク/権限/RLS）

---

## 10. 段階リリース計画

1) Phase 1: ローカル下書き保存 + Dirty誤判定修正（共同編集なし）
2) Phase 2: Presence（誰が開いてるか）導入
3) Phase 3: Broadcastでプレビュー配信（viewerが編集内容を見える）
4) Phase 4: DBロックテーブル（TTL）で編集権を堅牢化
5) Phase 5: 必要ならYjs導入

---

## 11. 後からYjsを導入できるようにする設計ポイント（重要）

### 11.1 抽象化する境界
- `NotesCollabTransport`（送受信）
  - `sendDraft(payload)` / `onDraft(handler)`
  - `sendPresence(state)` / `onPresence(handler)`
- `NotesPersistence`（永続化）
  - `saveSnapshot(content)` / `loadSnapshot()`
  - Phase 1〜Aでは “content=serialized notes”
  - Yjs導入後は “content=Yjs snapshot/update”

### 11.2 “Broadcast payload” を差し替えるだけでYjsを流せる
- いま: `notes:draft` に `fullText` or `delta`
- 将来: `notes:yjs-update` に `update`（binaryをbase64等）を流す
- Presenceはそのまま再利用（cursor/selectionもYjs awarenessに合わせやすい）

### 11.3 永続保存の形
- いま: Notes全文（JSON）をDBのcard.notesに保存
- 将来:
  - (a) Yjs snapshot を別カラム/別テーブルに保存
  - (b) 定期スナップショット + 増分updateログ（必要なら）

> 推奨：まずは「Yjs snapshotを一定間隔で保存」で開始し、必要が出たらログ方式へ。

---

## 12. 仕様まとめ（採用値）

- ローカル下書き保存: **500ms debounce**
- Broadcastプレビュー: **200ms throttle**（最大 5 msg/sec 目安）
- 永続保存: **2s debounce + maxWait 10s**
- 編集権: ソフトロック（最終的にDB TTLロック推奨）
- 破棄ダイアログ: 初回正規化差分を排除し、保存反映でdirty reset

---

## 付録: 画面仕様（UI）

- Notesヘッダーに表示:
  - 「編集中: 松本Ops」 / 「閲覧中: xx名」
  - 「保存中…」/「保存済み」
- viewer側:
  - editorの入力がリアルタイムで表示される
  - 編集しようとすると「現在は松本Opsが編集中。Take overしますか？」  
- Take over:
  - editorに通知（編集権移動）
  - viewerがeditorになり、送信を開始
