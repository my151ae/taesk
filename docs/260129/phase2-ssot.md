# Phase 2 SSOT: Timeline 契約（2026-01-29）

## 1. データモデル（DB 実態ベース）
### cards
- `due_date` (timestamptz): 日付の基準（JST で解釈）
- `due_start` / `due_end` (time): タイムライン上の時間帯
- `due_bucket` (text, `a|b`): A/B いずれか（day とは分離）
- `due_bucket_position` (float): A/B 内の並び順（降順）
- `duration` (int, minutes): 所要時間の基準値
- `checklist` / `content` / `excerpt`: 表示・同期用
- **`due_channel` は存在しない**（不要）
- **`description` は存在しない**（checklist/content へ移行）

### boards / profiles
- `boards.day_range` (1-7) / `boards.list_range` (1-120)
- `profiles.timeline_start_hour` (default 5)

## 2. Timeline 表示ルール（SSOT）
1. `due_date` が **存在しないカードは Timeline / A/B いずれにも表示しない**。
2. `due_date` があり、`due_start` と `due_end` が **両方ある** → **Timeline イベント**。
3. `due_date` があり、`due_start`/`due_end` が **未設定** → **A/B リスト**。
4. `due_bucket` が未設定の場合は **`b` にフォールバック**。
5. A/B の並びは `due_bucket_position` 降順（同値は title で安定化）。

## 3. Timeline API 契約（GET /api/boards/[boardId]/timeline）
### Query
- `start`: 日付ウィンドウのオフセット（日数、整数）
- `range`: 表示日数（1〜7）

### Response
```
{
  days: [{ key: "YYYY-MM-DD", label: "...", isoDate: "YYYY-MM-DD" }],
  events: [{
    card_id, due_date, due_start, due_end,
    durationMinutes, title, excerpt, tags, priority,
    checked, checklist, due_bucket, due_bucket_position,
    assignee_id, assignee_ids, assigned_to, duration,
    short_id, slug
  }],
  abBuckets: {
    "YYYY-MM-DD_a": [TimelineBucketItem],
    "YYYY-MM-DD_b": [TimelineBucketItem]
  },
  serverNow, startOffset, range
}
```
- `days.key` は常に `isoDate` と同値（ラベルは UI 表示用）。
- `abBuckets` のキーは **`${isoDate}_${due_bucket}`**。

## 4. 仕様上の型
- `DueBucket`: `'a' | 'b'`
- `Priority`: `'low' | 'medium' | 'high'`
- `assignee_ids` が正規、`assignee_id` / `assigned_to` は互換

## 5. 削除対象（仕様外）
- `due_channel` / `today_a` / `tomorrow_a` などの旧概念
- `description` フィールド

