# Google カレンダー連携 仕様まとめ

_最終更新: 2026-03-12_

## 概要

Taesk における Google カレンダー連携の全機能を記述する。大きく以下の 4 領域に分かれる。

1. **OAuth 接続・切断** — Google アカウントの認証フロー
2. **イベント取得・キャッシュ** — タイムラインへの表示
3. **カード変換・双方向同期** — Google 予定 ↔ Taesk カード
4. **Webhook・プッシュ通知** — リアルタイム同期

---

## 1. OAuth 接続・切断

### 1-1. 接続開始 `GET /api/integrations/google-calendar/connect`

- 認証済みユーザーが Google 連携を開始するエンドポイント。
- PKCE 相当の `state`（Base64url エンコードされた JSON: `{ userId, nonce, redirect }`）を生成し、Cookie に保存。
- Google OAuth 2.0 の認可 URL を組み立て、リダイレクトまたは JSON で返す（`format=json` クエリでモード切替可）。
- スコープ: `https://www.googleapis.com/auth/calendar`（読み書き権限）

### 1-2. コールバック `GET /api/integrations/google-calendar/callback`

- Google から受け取った `code` と `state` の照合（Cookie との一致確認）。
- OAuth トークン交換 → `access_token`, `refresh_token` を取得。
- `google_calendar_accounts` テーブルに upsert（`user_id, google_sub` でユニーク）。
- 接続完了後、`google_calendar_sync_states` を削除して次回スキャンで fresh watch を再登録させる。

### 1-3. 切断

- `disconnectGoogleCalendarAccount(userId)` — `google_calendar_accounts` レコードを削除。
- `GET /api/calendar/events` で Google API から 401/403/`invalid_grant` が返った場合、自動的に同アカウントを切断。

---

## 2. イベント取得・キャッシュ

### 2-1. `GET /api/calendar/events`

**モード 1: 接続確認のみ（`start`/`end` クエリ未指定）**
- Google アカウントの接続状態と書き込み権限（`canWrite`）を返すだけ。イベント一覧は空。

**モード 2: イベント取得（`start`, `end` クエリ指定）**
- 取得範囲: 最大 130 日。
- `listEventsForRange()` を呼び出し、内部でキャッシュ戦略を適用（後述）。
- すでに `calendar_sync` に `status: "active"` で紐付いているイベントはレスポンスから除外（タイムライン上は変換済みカードとして表示される）。
- エラーハンドリング:
  - 401/403/`invalid_grant` → 自動切断、`connected: false` を返す
  - 429（レートリミット）→ `status: 429` を返す
  - 503（Googleサービス停止）→ `status: 503` を返す
  - その他の Google エラー → DBキャッシュにフォールバック（`STALE_CACHE`）

### 2-2. キャッシュ戦略 (`googleCalendarServer.ts`)

Google API 呼び出しを最小化するための多段キャッシュ:

| 条件 | 動作 |
|--|--|
| `syncToken` あり かつ 最終同期 5 分以内 かつ ウィンドウカバー済み | キャッシュから返す（syncToken で差分のみ取得） |
| `syncToken` あり、ウィンドウ未カバー | フルフェッチして再キャッシュ |
| `syncToken` なし | フルフェッチして syncToken を保存 |
| Google へのアクセスが失敗 | DBキャッシュ（`google_calendar_events`）から返す |

- **フルフェッチウィンドウ**: 過去 28 日・未来 84 日（最大 2,500 件）
- **キャッシュ保存先**: `google_calendar_events` テーブル（`google_account_id, google_event_id` でユニーク）
- **キャッシュ期限切れ削除**: フェッチ毎に、ウィンドウ外の古いレコードを削除（`pruneCacheWindow`）
- **自己更新スキップ**: Taesk が Google 予定を更新してから 30 秒以内の更新は、自分自身の書き込みとみなしてスキップ（ループ防止）

### 2-3. フロントエンド: `useGoogleCalendar` フック

- `start`/`end` の範囲でイベントを取得し、`events` / `canWrite` / `status` / `error` を返す。
- キャッシュキー = `${startIso}_${endIso}` で同一範囲の重複リクエストを省く。
- `refresh()` でキャッシュを破棄して再取得。
- 接続状態: `connected` / `isConnected` プロパティを両方公開（未接続・エラー時に `false`）。

---

## 3. カード変換・双方向同期

### 3-1. Google 予定 → Taesk カード変換

#### (a) フロントエンド (`useTimelineCardActions.ts` の `handleExternalEventClick`)

> [!IMPORTANT]
> **現在、変換機能は一時停止されています。**
> 二重クリック問題への暫定対策としてコードがコメントアウトされており、クリックするとトーストメッセージが表示されるのみです。

- タイムライン上の外部イベント（Google 予定）をクリックすると発火。
- `google_event_id` を用いて `POST /api/calendar/convert` を呼び出す。
- 成功時: タイムライン再取得 + Google 予定一覧再取得 + カードモーダルを開く。

#### (b) バックエンド `POST /api/calendar/convert`

1. **認証・権限確認**: ユーザー認証 + ボードの編集権限確認。
2. **アカウント確認**: `google_calendar_accounts` の接続を確認。
3. **重複チェック**: `calendar_sync` テーブルに同一 `google_event_id` の既存カードがあれば、新規作成せずそのカードを返す（`reused: true`）。
4. **イベント詳細取得**: `google_calendar_events` キャッシュから日時・タイトル・概要を取得。
5. **カード作成**: `cards` テーブルに新規作成。終日予定は `due_bucket: "a"` で格納。
6. **同期登録**: `calendar_sync` に `status: "active"` で upsert。
7. **Google 予定への情報書き戻し**: 時間指定予定の場合は `syncCardToCalendar(onlyUpdate: true)` を呼び出し、Taesk カードへのリンクを Google 予定の説明欄に追記。

### 3-2. Taesk カード → Google 予定同期 (`/api/calendar-sync/[cardId]`)

| メソッド | 動作 |
|--|--|
| `POST /api/calendar-sync/{cardId}` | カードと Google 予定を双方向同期（作成・更新） |
| `POST /api/calendar-sync/{cardId}?google_event_id={id}` | 指定した Google 予定にカードを紐付けて同期（再シンク） |
| `GET /api/calendar-sync/{cardId}` | 同期ステータスを取得（`active` / `unlinked` / `deleted`） |
| `DELETE /api/calendar-sync/{cardId}` | Google 予定を削除し `status: "deleted"` に更新 |
| `DELETE /api/calendar-sync/{cardId}?mode=unlinked` | Taesk リンクを Google 予定の説明欄から削除し `status: "unlinked"` に更新 |

**POST の処理フロー:**
1. Pull sync: `syncGoogleCalendarToTaesk()` を実行してから...
2. Push: `syncCardToCalendar()` でカード情報を Google 予定に反映。

**`syncCardToCalendar` の詳細ロジック (`calendarSyncService.ts`):**
- 既存 Google 予定は `ETag` によるオプティミスティックロックで更新。
- Google 予定 (404/410) → 自動再作成フロー。
- ETag 不一致 (412) → 最新 ETag 取得後に 1 回リトライ。
- `privateExtendedProperty: taeskCardId={cardId}` による冪等性チェック（同一カードの重複作成を防止）。
- `onlyUpdate: true` の場合は既存 Google 予定がなければ何もしない。

**Google 予定の説明欄フォーマット:**
- `"Taesk: {カードの絶対 URL}"` という行を追記。
- `unlinkCardFromCalendar` は逆にこの行を除去してから unlink。

### 3-3. フロントエンド: カードモーダルの Google Sync 表示

#### `useCardModalGoogleSync` フック

- カードの `calendar_sync` から初期の同期ステータスを読み取り、マウント後に `/api/calendar-sync/{cardId}` で最新ステータスを取得。
- **手動同期** (`handleSyncNow`): `start`/`end` 設定済みで `syncStatus === "active"` の場合に `POST /api/calendar-sync/{cardId}` を呼ぶ。
- **再シンク候補取得** (`handleResyncRequest`): `/api/calendar/resync-candidates?title=...` で類似 Google 予定を検索。
- **再シンク実行** (`handleResyncSelect`): `POST /api/calendar-sync/{cardId}?google_event_id={id}` で特定の Google 予定を紐付け。

#### `GoogleSyncToggle` コンポーネント

- `displayMode`: `"panel"` / `"inline"` / `"menu"` の 3 種類の表示形式。
- 未接続・書き込み権限なし・同期 ON/OFF に応じた UI を提供。
- トグル ON → `POST /api/calendar-sync/{cardId}`、トグル OFF → `DELETE /api/calendar-sync/{cardId}?mode=unlinked`。

---

## 4. Webhook・プッシュ通知

### 4-1. Watch 登録 `POST /api/calendar/watch`

- `startCalendarWatch(userId, calendarId, address)` で Google カレンダーの`push` チャンネルを開設。
- 通知先 URL は `GOOGLE_CALENDAR_WEBHOOK_URL` 環境変数 → なければ `{origin}/api/integrations/google-calendar/webhook` の順で解決。
- localhost では Watch を自動スキップ（`GOOGLE_CALENDAR_WEBHOOK_URL` を設定すれば tunnel 経由で可能）。
- Watch は、イベントリスト取得時（`listEventsForRange`）に有効期限残り 30% 以下になると自動更新。

### 4-2. Watch 停止 `DELETE /api/calendar/watch`

- `stopCalendarWatch(userId, calendarId)` で Google チャンネルを停止。

### 4-3. Watch ステータス `GET /api/calendar/watch/status` *(注: 実装ファイルあり)*

### 4-4. Webhook 受信 `POST /api/integrations/google-calendar/webhook`

1. `x-goog-channel-id` で `google_calendar_sync_states` を検索。
2. `watch_channel_token` と `watch_resource_id` で正規性を検証（スプーフィング対策）。
3. `message_number` で重複着信をスキップ（`google_calendar_sync_logs` で確認）。
4. `google_calendar_sync_logs` にログ記録。
5. `google_calendar_sync_states` の `last_watch_at` / `watch_status` を更新。
6. `syncGoogleCalendarToTaesk(userId, calendarId, { reason: "webhook" })` を呼び出し、差分を Taesk に反映。

---

## 5. 再シンク候補検索 `GET /api/calendar/resync-candidates`

- **目的**: カードとの紐付けが外れた（`unlinked`）場合に、同名に近い Google 予定を提案する。
- **パラメータ**: `title`（必須）、`start`/`end`（省略時 = 過去 4 週・未来 12 週）。
- **アルゴリズム**: Jaro-Winkler 類似度 ≥ 0.75 で最大 50 件返す（DBキャッシュのみ参照）。

---

## 6. 関連テーブル

| テーブル名 | 役割 |
|--|--|
| `google_calendar_accounts` | Google OAuth トークン（`access_token`, `refresh_token`, `scope` 等）を保存 |
| `google_calendar_events` | Google 予定のローカルキャッシュ |
| `google_calendar_sync_states` | カレンダー別の同期状態（syncToken, Watch チャンネル情報等） |
| `google_calendar_sync_logs` | Webhook 着信ログ・ポーリングログ |
| `calendar_sync` | Taesk カードと Google 予定の紐付け（`status`, `google_event_id`, `etag` 等） |

---

## 7. 注意点と現状の課題

### 変換機能の一時停止
`handleExternalEventClick` の変換処理がコメントアウトされており、クリックしてもトーストのみ表示される。

### 二重送信（連打）耐性の欠如
- `handleExternalEventClick` に in-flight ガードや `disabled` 制御がない。
- ダブルクリックで `POST /api/calendar/convert` が 2 回送信されると、バックエンドでレースコンディションが発生し「予定が消えてカードモーダルが開かない」状態に陥るリスクがある。
- 詳細: [`docs/issues/google-calendar-double-click-bug.md`](../issues/google-calendar-double-click-bug.md)

### 終日予定の扱い
終日予定は `due_bucket: "a"`（全日バケツ）に配置され、時間指定がないため Google への書き戻し（`syncCardToCalendar`）はスキップされる。

### localhost での Webhook 制限
Google の Push 通知は公開 URL が必要なため、ローカル開発では自動的に Watch 登録がスキップされる。開発環境で Webhook をテストする場合は `GOOGLE_CALENDAR_WEBHOOK_URL` に ngrok 等のトンネル URL を設定する。
