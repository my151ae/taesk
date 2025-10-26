# 残りのテスト失敗修正 - 進捗レポート

**Date**: 2025-10-26 15:00 JST  
**Status**: 🟡 In Progress (70% complete)

## 完了した修正

### ✅ Phase 1: Board Permissions (4件) - 100% Complete

**修正内容**:
1. ShareDialog セレクタを strict mode 対応: `{ name: /share|settings/i }` → `{ name: 'Share board' }`
2. メンバーリストのセレクタ修正: `<tr, div>` → `div.filter({ hasText: /email/ })`  
3. ShareDialog に `role="dialog"` と `aria-labelledby` 追加（アクセシビリティ改善）
4. モックレスポンス形式を実際のAPI仕様に合わせた（`profile` オブジェクト構造）

**結果**: 全9件通過（core + full プロジェクト）

### ✅ Phase 2: Comments (7件) - 86% Complete (6/7)

**修正内容**:
1. Mention display: email → display name (`'E2E Test User'`)
2. Mention セレクタ: `span[class*="mention"]` → `[data-mention-id]`  
3. UUID validation テスト: `board_id` カラム削除（comments テーブルに存在しない）

**結果**: 
- ✅ 6件通過
- ⏸️ 1件残り: `should allow replying to comments` - 返信ボタンのセレクタ問題

**残作業**:
- Reply form 内の submit ボタンを正確に選択する必要あり
- 現在の `replyTextarea.locator('..').getByRole('button')` が動作していない

## 未着手

### ⏸️ Phase 3: Kanban (3件)
- should persist data after page reload @e2e:essential
- should restore snapshot on drag error @feature:boards
- should use normalized positions (1000/10 gaps) for new lists @feature:boards

### ⏸️ Phase 4: Notifications (2件)
- sends a test notification
- should mark notifications as read and clear badge

## 全体進捗

| Phase | 完了 | 失敗 | 進捗率 |
|---|---:|---:|---:|
| Board Permissions | 4 | 0 | 100% |
| Comments | 6 | 1 | 86% |
| Kanban | 0 | 3 | 0% |
| Notifications | 0 | 2 | 0% |
| **合計** | **10** | **6** | **63%** |

**Essential テスト**: 20/20 (100%) ✅  
**Full テスト**: 64/70 (91%)  

## 次のアクション

1. Reply test の修正（CommentsPanel コンポーネントのDOM構造確認が必要）
2. Kanban 3件の調査・修正
3. Notifications 2件の調査・修正
4. 全テスト再実行で70件通過を確認

## 技術的メモ

### Comments テーブルスキーマ
```sql
CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid REFERENCES cards(id),
  author_id uuid REFERENCES profiles(id),
  parent_id uuid REFERENCES comments(id),  -- 返信用
  body text,
  mentions uuid[],  -- UUID v4 配列
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  idempotency_key text
);
```

**重要**: `board_id` カラムは存在しない！

### Reply Form 構造 (要確認)
現在のセレクタが動作しないため、CommentsPanel.tsx で実際の DOM 構造を確認する必要がある。

