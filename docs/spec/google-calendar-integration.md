# Googleイベント連携 仕様まとめ

_最終更新: 2026-03-11_

## 対象機能
Taesk における「Googleイベント連携」および「Google予定からTaeskカードへの変換」機能。
（タイムライン上の Google 予定アイテムをクリックし、Taesk のカードとして新規作成・紐付けを行う導線）

## 仕様詳細

### 1. フロントエンドからの呼び出し (`useTimelineCardActions`)
- タイムラインまたはモバイル一覧で表示されている外部イベント（Google予定）をクリックすると、`handleExternalEventClick` が発火する。
- 選択された予定の `google_event_id` を用いて、`POST /api/calendar/convert` を呼び出す。
- **処理フロー:**
  1. 変換APIへリクエスト送信。
  2. 成功時、タイムラインデータ（`fetchTimeline()`）とGoogle予定一覧（`refreshGoogleCalendar()`）を再取得。
  3. 「Googleイベント変換完了」のトーストを表示。
  4. レスポンスに変換先カードの `short_id` が含まれていれば、カードモーダルを開く（`openCardModal`）。

### 2. バックエンドの変換処理 (`/api/calendar/convert`)
- **事前チェック:**
  - リクエストユーザーの認証およびボードの編集権限を確認。
  - ユーザーの `google_calendar_accounts` との接続状況を確認。
- **既存リンクの確認:**
  - `calendar_sync` テーブルを検索し、同一の `google_event_id` に紐付く既存カードがあれば、新たに作成せずそのカードを返却する（`reused: true`）。
- **新規カードの作成:**
  - `google_calendar_events` のキャッシュから対象イベントの詳細（日時、タイトル、概要など）を取得する。
  - ボード内にデフォルトのリスト(To Do等)を確保し、Googleイベントの内容をもとに Taesk の `cards` レコードを新規作成する（終日予定は `due_bucket: "a"` として配置）。
- **同期設定の有効化とGoogle予定側の更新:**
  - `calendar_sync` テーブルに `status: "active"` で sync レコードを作成（upsert）。
  - 時間指定予定（終日ではない）の場合、`syncCardToCalendar` を呼び出して、Taesk側で生成されたリンク情報などを元のGoogle予定詳細に反映・更新（`onlyUpdate: true`）する。
- **レスポンス:**
  - 生成（または取得）した `card` レコードと、`linked: true` を返却する。

## 注意点と現状の課題
- **表示のみの変換ではない:**
  この変換は単に表示を移すだけではなく、`calendar_sync` に登録し以降の双方向同期（Webhook / Pull sync）の対象に乗せる機能である。
- **終日予定の扱い:**
  終日予定は特定の時間枠を持たず、`due_bucket: "a"` （今日/全日バケツ）に格納される。
- **二重送信（連打）耐性:**
  現状、フロントエンドでのクリック処理に `in-flight` ガードやボタンの `disabled` 制御が入っていない。そのためダブルクリックされると、バックエンドでレースコンディションが発生し、同期的再取得のタイミングと合わさって「Google予定表示が消え、カードモーダルも開かない（開く前に再取得等で打ち消されたり、2回目のレスポンスでエラーになったりする）」という状態に陥るリスクがある。
