# スケジュールフィールド拡張（Timeline 基盤）

**Status**: 🔴 Not Started  
**Priority**: 🔥 High  
**Created**: 2025-11-13 14:30 JST  
**Assignee**: Backend  
**Estimated**: 2d

## 概要
Timeline/A/B レイアウトで必要となる「所属日」「開始/終了時刻」「配置先（timeline/ab）」などのフィールドをカードデータに追加し、Supabase・型定義・バックフィル方針を整える。

## 目的
- 時系列 UI が `due_date` だけに依存する状態を解消し、複数の表示モード間で一貫したデータを扱えるようにする。
- 既存の Kanban 利用ユーザーへの影響を最小限に抑えつつ、新フィールドを安全に rollout する。

## 実装内容
- [ ] Supabase migration: `cards` テーブルへ以下の列を追加（nullable）
  - `scheduled_date` (date)
  - `scheduled_start` (time without time zone)
  - `scheduled_end` (time without time zone)
  - `schedule_channel` (text) default `'list-only'`
  - `schedule_bucket` (text) nullable
- [ ] 既存行のバックフィル: `due_date` があるカードは `scheduled_date = date_trunc('day', due_date)` に初期化。
- [ ] `lib/supabase.ts` の `Card` 型・`CardUpsertPayload`・`sanitizeCardForUpload` を更新。
- [ ] API/サーバ側 DTO（`lib/server/cards.ts` 等）と `syncQueue` payload schema を更新。
- [ ] `tsconfig.tsbuildinfo` 以外に生成物が無いことを確認。

## 技術的詳細
- PostgreSQL では time zone の扱いに注意。保存値は UTC、UI 表示で `GMT+09` へ変換予定。`scheduled_start/end` は `TIME WITHOUT TIME ZONE` にして、`scheduled_date` と組み合わせてローカル時刻を再構築する。
- `schedule_channel` は `timeline`/`ab-list`/`list-only`/`archived` の ENUM 風文字列を想定。将来の追加に備え text + constraint で管理。
- Supabase migration は `supabase/migrations/<timestamp>_add_schedule_columns.sql` を新規作成し、`ALTER TABLE` 文 + デフォルト値設定 + インデックス（`board_id, scheduled_date`）を付与。

## 受け入れ基準
- [ ] `supabase migration` 実行後、`cards` テーブルに新列が存在する。
- [ ] `lib/supabase.ts` の型を参照する全ての TypeScript ファイルが型エラー無しでビルドできる。
- [ ] 既存カードが `schedule_channel='list-only'` で取得でき、Kanban UI で regress 無し。
- [ ] `npm run lint` で型・lint 通過。

## 関連チケット
- [00- TaeskMap マスタープラン](../taeskmap/00-today-list-layout.md)
- [02-timeline-query-endpoints.md](./02-timeline-query-endpoints.md)
