# Googleカレンダー連携 v1 実装ステップ（Supabase Auth / 読み取り専用）

## 全体概要（v1〜v3）— ざっくり早見
- **v1: 読み取り専用（MVP）**  
  - やること: Google予定を取得し、期間指定（例: 今週）で Timeline に重ねて表示。書き込みなし。  
  - 主な技術: Supabase Auth セッション / Supabase Postgres に資格情報保存 / OAuth2 スコープ `calendar.readonly` / Google Calendar API v3 / App Router Node.js runtime / サーバークライアント + API Route + フロントフック。
- **v2: Taesk→Google 書き込み（カード単位 opt-in）**  
  - やること: 「Google連携ON」のカードだけ Google予定を作成・更新・削除。Taesk→Google の単方向。  
  - 主な技術: v1 に加え、スコープ `calendar.events` 追加 consent / `calendar_sync` テーブル＋`sync_enabled` で紐付け管理 / extendedProperties.private に card ID などを埋め込み / POST/PUT/DELETE API。
- **v3: 双方向同期（Webhook + 差分）**  
  - やること: Google 側変更も取り込み整合を保つ。  
  - 主な技術: v2 に加え、`events.watch`（カレンダー単位通知）＋ Webhook 受信 → `syncToken` 付き `events.list` で差分取得 / `calendar_watch_channels` テーブル / 差分同期ジョブと watch 更新ジョブ / ループ防止（self-change 判定）。

本書は v1 を実装開始できる内容に絞る。Firestore は使わず **Supabase/Postgres + Supabase Auth** 前提。

## ゴールと前提
- ゴール: Google カレンダーの予定（今週など期間指定）を取得し、Taesk Timeline に表示する。書き込みなし。
- 認証: ログインは Supabase Auth。カレンダー連携は別口の Google OAuth（スコープ `calendar.readonly`）。Node.js Runtime 強制。
- データ保存: `google_calendar_accounts` テーブルに資格情報を保存（トークンは DB で暗号化する運用）。

## ステップ1: OAuth 接続と資格情報保存
- [x] `google_calendar_accounts` テーブル作成（マイグレーション適用済み）
- [x] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を env に追加（`.env.example` 反映済み）
- [x] `/api/integrations/google-calendar/connect` で state 付き認可 URL を返却
- [x] `/api/integrations/google-calendar/callback` で token 交換・refresh_token 温存・upsert
- [x] リダイレクトを絶対 URL 化・onConflict 指定・エラー詳細ログ
- [x] 実機で接続 → DB 保存 → 予定取得まで確認
- 必須決定
  - スコープは `https://www.googleapis.com/auth/calendar.readonly`
  - リダイレクト URI（例）: `https://<app-domain>/api/integrations/google-calendar/callback`
  - env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - OAuth `state` を必ず付与（ランダム＋user_id をエンコード）。`callback` で検証し、CSRF・別ユーザー紐付けを防ぐ。
  - 認可URLは `access_type=offline` ＋ 必要に応じて `prompt=consent` を付与し、初回に refresh_token を確実にもらう。
- DB
  - `google_calendar_accounts(user_id, google_sub, email, access_token, refresh_token, scope, token_expires_at, ...)` を作成（`profiles.id` に FK, UNIQUE(user_id, google_sub)）。
  - アクセス/リフレッシュトークンは暗号化保存。
- API
  - `GET /api/integrations/google-calendar/connect`: Supabase セッションから `user_id` 取得→OAuth 認可 URL を生成して 302 リダイレクト or JSON 返却。
  - `GET /api/integrations/google-calendar/callback`: `code` を受け取り `oauth2Client.getToken`→ `google_calendar_accounts` に upsert。`tokens.refresh_token` が空のときは既存の refresh_token を保持し、上書きで消さない。
- 開発確認
  - 設定画面から接続→Google 同意→callback で DB にレコード作成/更新されること（refresh_token がクライアントに漏れない）。
  - 401/403（権限取り消し・refresh 無効・refresh が返らない等）が発生したときは DB のトークンを無効化し、「未接続」扱いで再接続を促す。

## ステップ2: サーバークライアントとイベント取得 API
- [x] サーバー専用クライアント `lib/googleCalendarServer.ts` 実装（refresh 対応）
- [x] `GET /api/calendar/events?start&end` 実装（未接続=connected:false、429/503/401/403 のハンドリング）
- [x] 31 日以内のバリデーション、start/end チェック
- [x] JST終日処理（date のみは 0:00〜24:00 として返却）
- [ ] バリデーション系のテスト追加（任意）
- 必須決定
  - サーバー専用クライアント `lib/googleCalendarServer.ts` を Node.js runtime で実行。
  - 期限切れなら refresh_token で再取得→DB 更新。
  - タイムゾーンは当面 Taesk 側で保持（デフォルト `Asia/Tokyo`）。終日イベント（`date` のみ）は 0:00〜24:00 の終日扱いで返す。
  - 429（レート制限）は 429 or 503 で返し、フロントに「時間をおいて再実行」を表示させる軽い方針。
  - `start/end` のバリデーションを入れる（`start > end` は 400、取得範囲は最大 31 日などに制限）。
- 実装
  - `getGoogleCalendarClientForUser(userId)`: `google_calendar_accounts` 取得→必要ならリフレッシュ→`google.calendar({version:'v3', auth})` を返す。
  - `listEventsForRange(userId, start, end, calendarId = 'primary')`: `calendarId` は将来拡張を見据えて引数化。`timeMin/timeMax` で取得、`singleEvents: true`, `orderBy: 'startTime'`。
  - API: `GET /api/calendar/events?start=ISO&end=ISO`（Supabase セッションから user_id 取得→上記関数呼び出し→必要フィールドを JSON 返却）。レスポンスは Taesk 用の薄い型（`id/title/start/end/isAllDay/source/connected` など）に整形し、生データは返さない。未接続時は 200 + `connected=false, events: []`（フラグ方式）で返し、通常エラー（500系）と区別。
- 開発確認
  - ログイン状態で `/api/calendar/events?start=<今週月曜>&end=<今週日曜>` を叩き、イベント配列が返ること（401/403 の挙動も確認）。

## ステップ3: フロント統合と表示
- [x] `useGoogleCalendar` フックで可視範囲に合わせて取得・簡易キャッシュ
- [x] タイムラインに読み取り専用レイヤーを追加（緑/Gバッジ、タイトル・時間表示）
- [x] 未接続/エラー/ローディングのバナー表示と再接続導線
- [x] 期間プリセット UI（表示範囲/今週/来週）を追加
- [x] 再接続後のトースト表示を追加
- 必須決定
  - 表示は「読み取り専用レイヤー」としてカードと区別する（色/透明度など）。
  - 再フェッチは期間が変わったときのみ（簡易キャッシュで可）。
  - 期間指定 UI: Google連携設定画面を用意し、取得期間のプリセット（例: 今週/来週/カスタム）を選択できるようにする。デフォルトは「今週」。Timeline 側の可視期間と連動させる。
  - API 呼び出し範囲の優先度: 基本は「Timeline 可視範囲 ± α」。設定画面プリセットは初期値・上限の決定に使うイメージ。
- 実装
  - `useGoogleCalendar(startDate, endDate)`: 上記 API を叩き、`events / loading / error / status`（`disconnected`/`loading`/`success`/`error`）を返す簡易キャッシュ付きフック。`status='disconnected'` は API の `connected=false` を見て判定する。
  - `TimelineBoardPage`: 可視範囲の日付をフックに渡し、イベントを別レイヤーで描画。設定画面の期間指定を反映して `start/end` を決定。
- 開発確認
  - Timeline を開き、今週の Google 予定が時間軸上に表示されること。
  - ローディング中/エラー時の表示が出ること。
  - 未接続状態で「Google連携が切れています。再接続してください」等の表示になること。

## 追加メモ（v2/v3 を見据えた v1 での種まき）
- `calendar_sync` テーブルは v2 以降で利用（v1 では必須でないがスキーマ作成は検討可）。
- `extendedProperties.private` に `taeskCardId` などを書くのは v2 以降で実施。
- Webhook (`events.watch`) は v3 で着手。それまではポーリングしない。`events.watch` はカレンダー単位通知のみなので、Webhook 受信後に `syncToken` 付き `events.list` で差分を取るのが前提。
- ログ/PII 方針: `access_token`/`refresh_token` や生イベント本文はログに出さない。本番ではイベントID＋ステータス程度に制限し、詳細ログは開発用に限定。
- self-change 防止（v2/v3）: Taesk から書いたイベントには `extendedProperties.private.taeskCardId` / `taeskUpdatedAt` などを付与し、差分取得時に「自分が直前に書いたものか」を判定して無限ループを防ぐ。

---

## 進捗メモ（2025-12-04）
- v1 実装済み: `google_calendar_accounts` マイグレーション、OAuth フロー（connect/callback）、サーバークライアント・イベント取得 API (`GET /api/calendar/events`)、フロント統合（`useGoogleCalendar`＋タイムラインへの重ね描画・接続/再接続バナー）。実機で予定取得・表示を確認済み。
- 既知修正: コールバックのリダイレクトを絶対 URL 化、upsert の onConflict 指定を追加、エラー詳細のロギングを拡充。
- UI: Google 予定は緑レイヤー＋「G」バッジで表示。タイトルは 1 行省略、時間ラベルを併記。

## 残タスク/次にやること
1. バリデーション強化: `/api/calendar/events` の 31 日制限済みだが、異常パラメータのテストケース追加（任意）。
2. UX: 未接続→接続完了時のトースト/リロード制御を詰める（今はバナー操作のみ）。必要なら「切断」ボタンも追加検討。
3. セキュリティ運用: トークンの暗号化運用（pgsodium 等）をインフラ側で設定するか要確認。
4. v2 以降: `calendar_sync` テーブルの作成、書き込み API、extendedProperties.private 設計、差分同期 (watch + syncToken) の設計に着手。
