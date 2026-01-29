# Phase 4: レガシー棚卸し（2026-01-29）

## 目的
Timeline 専用運用を前提に、**削除・隔離できるレガシー**と**当面残す必要がある互換部**を切り分ける。

## 1. Kanban UI
- **対象**: `app/(board)/_components/KanbanBoardClient.tsx`
- **参照状況**: 直接 import されている箇所は **無し**（自己完結）。
- **影響点**: コメント内の言及 (`CommentsPanel.tsx`) のみ。
- **対応**: **削除済み**（CommentsPanel のコメントも整理）。

## 2. list 系 API（Kanban 互換）
- **対象**:
  - `app/api/boards/[boardId]/data`
  - `app/api/boards/[boardId]/lists/*`
  - `app/api/boards/[boardId]/cards/reorder`
  - `app/api/boards/[boardId]/cards/renumber`
  - `app/api/boards/[boardId]/lists/reorder`
  - `app/api/boards/[boardId]/lists/renumber`
- **参照状況**:
  - `KanbanBoardClient.tsx` が呼び出し
  - **E2E**: `e2e/reorder-api.spec.ts` が lists/cards reorder を直接検証
- **判断**: **E2E 依存を解消済み**。削除へ移行可能。

## 3. Board Data API
- **対象**: `app/api/boards/[boardId]/data`
- **参照状況**: `KanbanBoardClient.tsx` のみ
- **対応**: **削除済み**。

## 4. assignee 互換
- **対象**: `assigned_to` / `assignee_id` / `assignee_ids`
- **参照状況**: UI/API/SyncQueue 全体で混在
- **判断**: **広範囲影響**のため Phase4 では削除対象外。Phase5 以降で移行計画が必要。

## 5. BlockNote 互換
- **対象**: `lib/tiptap.ts` の array 入力
- **参照状況**: content 正規化で利用
- **判断**: 既存データの互換要素のため Phase4 では削除しない。

## 6. 直近で削除候補になり得るもの
- list 系 API 一式（削除済み）

## 7. 次のステップ（Phase4 完了）
- Kanban UI 削除、list 系 API 削除、E2E 依存解消まで完了。
- 次フェーズで `lists` テーブルの要否と cards/list 依存の整理を検討する。
