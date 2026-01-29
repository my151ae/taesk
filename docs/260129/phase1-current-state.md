# Phase 1: 現状確定サマリ（2026-01-29）

## 1. 実装の現況（コード側）
### UI / Routing
- 主要 UI は `TimelineBoardPage` を中心とする Timeline + A/B + List View。
- `/b/:short_id/:slug?` がボード正規ルート、`/board` はメンバー初期ボードへリダイレクト。
- Card Modal は @modal intercept + `?card=` 遷移で開閉（Next.js 15 バグ回避のため）。

### Timeline データ契約
- `app/api/boards/[boardId]/timeline/route.ts`
  - `days[]` は ISO 日付キー (`YYYY-MM-DD`) を `key` として返却。
  - `abBuckets` のキーは `${day.key}_a` / `${day.key}_b`。
  - `due_bucket` は `'a' | 'b'` を前提。
  - `due_channel` は使用していない（ロジック上は `due_start/due_end` の有無で Timeline or A/B を判定）。

### 型定義
- `lib/supabase.ts`: `DueBucket = 'a' | 'b'`。
- `lib/api-types/timeline.ts`: `TimelineBucketItem.due_bucket?: string`（より緩い）。
- `app/(board)/_utils/card-updates.ts`: `normalizeDueBucket()` で `'a'|'b'` 強制。

### 主要機能
- Realtime: `useRealtimeBoard.ts`
- Sync Queue: `lib/syncQueue.ts`
- Comments: `CommentsPanel.tsx` / `useCommentsStore`
- Notifications: `NotificationSettings.tsx`, `NotificationsBell.tsx`, `NotificationSoundPlayer.tsx`
- Google Calendar: `useGoogleCalendar.ts` / `lib/googleCalendarServer.ts`

## 2. ドキュメントとの乖離（確定事項）
- **A/B バケット仕様**
  - docs: `today_a / today_b / tomorrow_a / tomorrow_b` と `due_channel` を前提。
  - code: `due_bucket = 'a'|'b'` + `days` の `isoDate` をキーに `${day}_a` 形式。
- **表示範囲**
  - docs: Today/Tomorrow 2日固定。
  - code: `day_range` 最大7日、`list_range` 最大120日（Timeline/List の range 切替あり）。
- **Kanban 表記**
  - `app/layout.tsx` / `app/login/page.tsx` の Kanban 文言は Phase4 で更新済み。

## 3. レガシー／互換コード（確定事項）
- Kanban UI: `app/(board)/_components/KanbanBoardClient.tsx` は Phase4 で削除済み。
- list 系 API: `app/api/boards/[boardId]/lists/*` / `boards/[boardId]/data` は Phase4 で削除済み。
- assignee 互換: `assigned_to` + `assignee_id` + `assignee_ids` が混在。
- BlockNote 互換: `lib/tiptap.ts` の array 入力処理。
- Calendar Sync API: `app/api/calendar-sync/[cardId]/route.ts` が `card.description` を参照（DBで description が drop 済みなら不整合）。

## 4. DB 実態確認結果（Supabase: your-project-ref）
### cards
- `due_bucket` は `a/b` 制約（`today_a` 形式ではない）。
- `due_channel` 列は **存在しない**（update_bucket_schema 適用済み）。
- `description` 列は **存在しない**（checklist へ移行済み）。
- `duration` 列が存在（default 60）。
- `due_bucket_position` / `due_start` / `due_end` は存在。
- `content` / `excerpt` が存在（Tiptap / 抜粋用）。

### boards / profiles
- `boards.day_range`（default 2）と `boards.list_range`（default 30）が存在。
- `profiles.timeline_start_hour`（default 5）が存在。

### 適用済みマイグレーション（抜粋）
- `update_bucket_schema`（20251125032707）
- `add_checklist_to_cards`（20251129090000）
- `add_card_content`（20251220000654）
- `add_duration_to_cards_v2`（20260106221047）
- `add_day_range_to_boards`（20251201040931）
- `add_list_range_to_boards`（20260112021324）

## 5. Phase 1 で確定させるべき結論
- **SSOT とする Timeline 契約**（A/B キーと due_bucket の仕様）
- **DB 実態に合わせた docs 改訂範囲**
- **legacy 削除対象の最小セット**（Kanban UI / lists API など）

## 6. 次アクション（Phase 1 完了 → Phase 2 への引き継ぎ）
- **Timeline 契約の SSOT を確定**（A/B キー = `${isoDate}_a/b`、`due_bucket = a|b`）。
- docs の修正対象を確定（`docs/index.md` / `docs/detail/*` の today/tomorrow 前提を更新）。
- `calendar-sync` が `card.description` を参照している件の修正方針を決める。
