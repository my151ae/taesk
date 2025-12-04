# Googleカレンダー連携 実装設計（Supabase Auth 版）

## 0. 前提とゴール

- 認証の主役は **Supabase Auth** のまま維持する。
- Google カレンダー連携は「外部サービス連携」として、
  - v1: **読み取り専用**（Taesk → Google への書き込みなし）
  - v2: Taesk → Google への書き込み
  - v3: 双方向同期（Webhook + 差分同期）
 という段階的リリースを前提にする。
- 既存の `01-google-calendar-integration.md` で想定している **NextAuth ベース構成は採用しない**。

---

## 1. Firestore を使うか問題の整理

### 1-1. Supabase + Postgres で十分か？

**結論: Taesk の現状構成なら、Firestore を増やさず Supabase/Postgres に寄せた方が楽。**

理由:
- すでに Supabase を使っており、
  - DB 接続設定
  - マイグレーション
  - Supabase Auth とユーザー紐付け
  が整っている。
- Google カレンダー連携で必要なデータは、
  - Google OAuth の資格情報（access/refresh token, scope, expires_at）
  - カードとイベントの紐付け（`calendar_sync`）
  - 将来の Webhook 用の watch チャンネル管理
 だけなので、**リレーショナルに扱える量・構造**。
- Firestore を増やすと、
  - インフラ（権限管理・バックアップ・監視）が 1 個増える
  - 「Taesk のユーザーID」との整合性を別 DB 間で維持する必要が出る
  ため、トータルの運用コストが上がる。

### 1-2. もし Firestore にするメリットがあるとしたら

- ほぼ **ネイティブモバイルから直接 Firestore に叩きたい** 等の理由があるとき。
- 今回のように Next.js + Supabase のサーバー経由で Google API を叩く構成では、
  - Postgres の方が既存資産をそのまま使いやすい。

→ 今回の Google カレンダー連携に関しては、**Supabase/Postgres 継続がベスト** という前提で設計を進める。

---

## 2. コスト・クオータの考え方（v1: 読み取り専用 / v2,v3: 双方向）

### 2-1. Google Calendar API の料金

- Google Calendar API 自体の利用は **追加料金なし** で、
  - プロジェクトごと & ユーザーごとのクオータ制。
- 代表的なクオータのイメージ:
  - プロジェクト全体でのデフォルトは **1,000,000 リクエスト/日 程度**。
  - 現在は日単位ではなく **分単位スロットル**（per minute per project / per user）で制御される。
- クオータを超えた場合は `403` / `429` を返して**レート制限**されるだけで、
  - **超過料金が発生するわけではない**。

→ v1〜v3 で普通にカレンダーを同期する程度であれば、「Calendar API の利用料が膨れ上がる」という心配はほぼ不要。懸念は **レート制限に当たらないように設計すること**。

### 2-2. 双方向同期でクオータに優しい構成

- ポーリングで `events.list` を叩き続けると、ユーザー数に比例してクオータ消費が増える。
- v3（双方向同期）では、
  - `events.watch` + Webhook + `syncToken` による差分取得で、
  - 「変更があったときだけ差分を取る」構成にする。

これにより、
- クォータ利用はおもに
  - 初回同期時の `events.list`（期間指定）
  - 差分取得時の `events.list({ syncToken })`
  に限定されるため、クォータ・料金面でかなり安全。

### 2-3. それ以外のコスト（Supabase 側など）

- Supabase の Free/Pro プランの従量課金は、
  - 主に **DB 容量 / ネットワーク egress / Edge Functions の呼び出し数** に紐づく。
- Google カレンダー連携で増えるのは、
  - `google_calendar_accounts` / `calendar_sync` / `calendar_watch_channels` などのレコード
  - Webhook → 同期ジョブを流す Edge Function の呼び出し
  くらいなので、ユーザー数が急増しない限りは大きな追加コストにはなりにくい。

---

## 3. データベース設計（Supabase / Postgres）

### 3-1. Google アカウント情報テーブル

Google OAuth の資格情報を保持するテーブル。Supabase の `profiles`（仮）と紐付ける。

```sql
CREATE TABLE google_calendar_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  google_sub text NOT NULL,
  email text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  scope text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, google_sub)
);
```

> 運用上は `access_token` / `refresh_token` に対して **暗号化** をかける。（Supabase の暗号化拡張など）

### 3-2. カードとイベントの紐付けテーブル（v2+）

v1（読み取り専用）では必須ではないが、将来 Taesk ↔ Google を紐付けるためのテーブル。

```sql
CREATE TABLE calendar_sync (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  google_event_id text NOT NULL,
  calendar_id text DEFAULT 'primary',
  last_synced_at timestamptz DEFAULT now(),
  sync_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(card_id, google_event_id)
);
```

### 3-3. watch チャンネル管理テーブル（v3）

Webhook + 差分同期用。

```sql
CREATE TABLE calendar_watch_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  calendar_id text NOT NULL,          -- 'primary' など
  channel_id text NOT NULL,           -- 自前で生成する UUID
  resource_id text NOT NULL,          -- Google から返される ID
  resource_type text NOT NULL,        -- 'events'
  sync_token text,
  expiration_at timestamptz NOT NULL,
  last_notified_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, calendar_id, channel_id)
);
```

---

## 4. Google OAuth フロー（Supabase Auth と共存）

### 4-1. 全体像

- Taesk のログインは **Supabase Auth**。
- Google カレンダー連携は別口の OAuth で、
  - Supabase のセッションから `user_id` を取り、
  - そのユーザーにぶら下がる `google_calendar_accounts` レコードを作成/更新。

### 4-2. エンドポイント構成案

```text
GET  /api/integrations/google-calendar/connect   
  → Google の認可 URL を返す or 302 でそのままリダイレクト

GET  /api/integrations/google-calendar/callback
  → code を受け取り、access/refresh token を発行→ DB 保存
```

※ Next.js App Router 前提で `app/api/.../route.ts` として実装。

### 4-3. `/connect` 実装イメージ

- ログイン中の Supabase ユーザーを取得。
- Google OAuth の認可 URL を生成。
- 必要なスコープは v1 では `calendar.readonly` のみ。

```ts
// app/api/integrations/google-calendar/connect/route.ts

export const runtime = 'nodejs';

export async function GET() {
  // 1. Supabase セッションから user_id を取得
  // 2. Google OAuth2Client を初期化
  // 3. 認可 URL を発行
  // 4. 302 でリダイレクト or JSON で返す
}
```

### 4-4. `/callback` 実装イメージ

- `code` を受け取って `oauth2Client.getToken(code)`。
- 返ってきた `tokens`（access_token / refresh_token / expiry_date / scope）を `google_calendar_accounts` に保存。
- 既存レコードがあれば更新。

```ts
// app/api/integrations/google-calendar/callback/route.ts

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // 1. Supabase セッションから user_id
  // 2. query param から code を取得
  // 3. oauth2Client.getToken(code)
  // 4. google_calendar_accounts に upsert
  // 5. フロントの設定画面にリダイレクト
}
```

---

## 5. v1: カレンダー読み取り専用実装

### 5-1. サーバー側クライアント `lib/googleCalendarServer.ts`

責務:
- Supabase セッションから `user_id` を取得
- `google_calendar_accounts` から資格情報を取得
- リフレッシュが必要なら refresh_token を使って更新
- `google.calendar({ version: 'v3', auth })` を返す

```ts
// lib/googleCalendarServer.ts（サーバー専用）

export async function getGoogleCalendarClientForUser(userId: string) {
  // 1. google_calendar_accounts から行を取得
  // 2. 期限切れなら refresh_token で access_token を更新
  // 3. oauth2Client.setCredentials(...)
  // 4. return google.calendar({ version: 'v3', auth: oauth2Client });
}

export async function listEventsForRange(userId: string, start: Date, end: Date) {
  const calendar = await getGoogleCalendarClientForUser(userId);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return res.data.items ?? [];
}
```

### 5-2. API ルート `/api/calendar/events`（GET のみ）

```ts
// app/api/calendar/events/route.ts

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // 1. Supabase セッションから userId 取得
    // 2. query から startDate / endDate をパース
    // 3. listEventsForRange(userId, start, end) を呼ぶ
    // 4. 必要なフィールドだけ整形して返す
  } catch (e) {
    // ログ + 500
  }
}
```

返却型は既存 `01-google-calendar-integration.md` の `GoogleCalendarEvent` に近いものをそのまま流用。

### 5-3. クライアント側フック `useGoogleCalendar`

既存案をほぼそのまま流用しつつ、
- `startDate` / `endDate` が同じ間は再フェッチしない
- ローディング・エラー状態を Timeline でわかりやすく出す
などのチューニングを入れる。

```ts
// hooks/useGoogleCalendar.ts

export function useGoogleCalendar(startDate: Date, endDate: Date) {
  // 既存案 + 簡易キャッシュ
}
```

### 5-4. Timeline への統合

- `TimelineBoardPage.tsx` で、
  - 表示している日付範囲を `useGoogleCalendar` に渡す。
  - カレンダーイベントはカードとは別のレイヤー（色・スタイル）で表示。

---

## 6. セキュリティ・権限まわりの注意点

1. **refresh token をクライアントに流さない**
   - JWT/Session に `refresh_token` をそのまま入れない。
   - サーバー側の DB のみに保存。
2. **スコープは最小限**
   - v1 は `calendar.readonly` のみ。
   - v2 以降で書き込みが必要になった段階で `calendar.events` を追加 consent。
3. **トークンの暗号化**
   - Supabase の暗号化拡張 or アプリ側暗号化を利用。
4. **Node.js Runtime を強制**
   - `lib/googleCalendarServer` を呼ぶ API ルートは `runtime = 'nodejs'` を指定。

---

## 7. v2 / v3 向けの設計メモ（双方向同期）

ここは v1 実装後に着手する前提。ざっくりの TODO だけ書いておく。

### 7-1. Taesk → Google 書き込み（v2）

- `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent` を `lib/googleCalendarServer.ts` に追加。
- `/api/calendar/events` に `POST/PUT/DELETE` を追加。
- 成功時に `calendar_sync` テーブルを更新（card_id ↔ google_event_id）。
- 書き込み時に、Google イベントの `extendedProperties.private` に以下を入れておく：

```json
{
  "taeskCardId": "<card uuid>",
  "taeskUpdatedAt": "2025-12-04T12:34:56Z"
}
```

### 7-2. Webhook + 差分同期（v3）

1. **watch チャンネル登録 API**
   - `POST /api/calendar/watch` で `events.watch` を叩き、
   - `calendar_watch_channels` に `channel_id` / `resource_id` / `expiration_at` / `sync_token` を保存。

2. **Webhook エンドポイント**
   - `POST /api/calendar/webhook` で Google からの通知を受ける。
   - ヘッダ（`X-Goog-Channel-ID`, `X-Goog-Channel-Token`, `X-Goog-Resource-ID` 等）を検証。
   - 対応する `calendar_watch_channels` を特定し、
     - ここでは「差分同期ジョブをキューに積むだけ」に留める。

3. **差分同期ジョブ**
   - ジョブ実行側で `events.list({ syncToken })` を叩き、差分を取得。
   - 各イベントについて
     - `extendedProperties.private` と `updated` を見て「自分が直前に書いた変更か」を判定し、無限ループを回避。
   - `calendar_sync` + `cards` を更新し、`sync_token` を更新。

4. **watch 更新ジョブ**
   - `expiration_at` が近づいている `calendar_watch_channels` を定期的にチェックし、
   - 新しい `events.watch` を発行して更新。

---

## 8. 実装順序（v1 想定）

1. `google_calendar_accounts` テーブル作成
2. `/api/integrations/google-calendar/connect` / `/callback` を実装
3. `lib/googleCalendarServer.ts` でサーバー側クライアントを実装
4. `/api/calendar/events`（GET）の実装
5. `useGoogleCalendar` フックと Timeline 統合
6. UX 調整（ローディング・エラー表示、カレンダーイベントのスタイル）

これで「Supabase Auth を維持したまま、Google カレンダーの読み取り専用連携」を v1 としてリリース可能な状態になる。

