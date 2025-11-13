# due_* フィールド拡張（Timeline 基盤）

**Status**: 🔴 Not Started  
**Priority**: 🔥 High  
**Created**: 2025-11-13 14:30 JST  
**Assignee**: Backend  
**Estimated**: 2d

## 概要
Timeline/A/B レイアウトで必要となる「所属日」「開始/終了時刻（1 分単位）」「配置先（timeline/ab）」などのフィールドをカードデータに追加し、Supabase・型定義・バックフィル方針を整える。旧カンバン用のフィールド遺産は残さず、Timeline を新デフォルトに近づける準備を整える。

## 目的
- 時系列 UI が `due_date` だけに依存する状態を解消し、複数の表示モード間で一貫したデータを扱えるようにする。
- 既存の Kanban 利用ユーザーへの影響を最小限に抑えつつ、新フィールドを安全に rollout する。

## 実装内容
- [ ] Supabase migration: `cards` テーブルへ以下の列を追加（nullable, JST 基準）
  - `due_start` / `due_end` (time without time zone, 分解能 1 分)
  - `due_channel` (text) default `'list-only'` （`timeline` / `ab-list` / `archived` を許容）
  - `due_bucket` (text) `today_a|today_b|tomorrow_a|tomorrow_b|null`
- [ ] `due_date` を Timeline の基準日として継続利用し、`due_start/end` が無い既存カードにはデフォルト値（null）を保持。
- [ ] `lib/supabase.ts` の `Card` 型・`CardUpsertPayload`・`sanitizeCardForUpload` を更新。
- [ ] API/サーバ側 DTO（`lib/server/cards.ts` 等）と `syncQueue` payload schema を更新。
- [ ] `tsconfig.tsbuildinfo` 以外に生成物が無いことを確認。
- [ ] A/B 固有メタ（`due_bucket`）を enum 風に管理するユーティリティを `lib/due.ts`（仮）に追加し、UI 側からも参照できるようにする。
- [ ] `lib/supabase.ts` の `Card` 型・`CardUpsertPayload`・`sanitizeCardForUpload` を更新。
- [ ] API/サーバ側 DTO（`lib/server/cards.ts` 等）と `syncQueue` payload schema を更新。
- [ ] `tsconfig.tsbuildinfo` 以外に生成物が無いことを確認。
- [ ] A/B 固有メタ（`schedule_bucket`）を enum 風に管理するユーティリティを `lib/schedule.ts` に追加し、UI 側からも参照できるようにする。

## 技術的詳細
- PostgreSQL では time zone の扱いに注意。保存値は `due_date` (date) + `due_start/due_end` (time without time zone) で JST を表現し、UI で `GMT+09` として解釈する。
- `due_channel` は `timeline`/`ab-list`/`list-only`/`archived` の ENUM 風文字列を想定。将来の追加に備え text + constraint で管理。
- Supabase migration は `supabase/migrations/<timestamp>_add_due_columns.sql` を新規作成し、`ALTER TABLE` 文 + デフォルト値設定 + インデックス（`board_id, due_date`）を付与。
- A/B リストは既存 list_id とは切り離し、`due_channel='ab-list'` のカードのみが `due_bucket` を持つ設計にする。Timeline と同時所属は認めない。

## 受け入れ基準
- [ ] `supabase migration` 実行後、`cards` テーブルに新列が存在し、1 分単位の start/end が保持できる。
- [ ] `lib/supabase.ts` の型を参照する全ての TypeScript ファイルが型エラー無しでビルドできる。
- [ ] 既存カードが `due_channel='list-only'` で取得でき、旧 Kanban ビューに依存しない。`due_date` は読み取り専用で残る。
- [ ] `npm run lint` で型・lint 通過。

## 関連チケット
- [00- TaeskMap マスタープラン](./00-today-list-layout.md)
- [02-timeline-query-endpoints.md](./02-timeline-query-endpoints.md)
