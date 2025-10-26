# 残りのテスト失敗を修正 - 2025-10-26

**Status**: 🟡 In Progress  
**Priority**: 🔴 High  
**Created**: 2025-10-26 13:55 JST  
**Assignee**: Claude  
**Estimated**: 2-3 hours

## 概要

Essential テスト (20件) は全て通過したが、全テスト実行では 16件の失敗が残っている。カテゴリ別に段階的に修正し、全75件（70件実行 + 5件スキップ）を通過させる。

## 現状サマリー

| カテゴリ | 成功 | 失敗 | スキップ | 合計 |
|---|---:|---:|---:|---:|
| **Essential** | 20 | 0 | 0 | 20 |
| **Full** | 54 | 16 | 5 | 75 |

### 失敗内訳

1. **board-permissions.spec.ts** (4件)
   - should change member role
   - should remove board member
   - should display invite link section (Phase 3) @phase3
   - should prevent non-owner from changing owner role @failure:permissions

2. **comments.spec.ts** (7件)
   - should show Comments tab in card modal via ?card= route
   - should preserve card modal state on reload with ?card= query
   - should create a comment successfully
   - should edit and delete own comment
   - should allow replying to comments
   - should validate mention user_id as UUID v4
   - should sync comments across multiple browser contexts

3. **kanban.spec.ts** (3件)
   - should persist data after page reload @e2e:essential
   - should restore snapshot on drag error @feature:boards
   - should use normalized positions (1000/10 gaps) for new lists @feature:boards

4. **notifications.spec.ts** (2件)
   - sends a test notification
   - should mark notifications as read and clear badge

## 修正計画

### Phase 1: Board Permissions (4件)
- [ ] ロール変更機能のテスト修正
- [ ] メンバー削除機能のテスト修正
- [ ] Phase 3 招待機能テスト（スキップ確認）
- [ ] 権限チェックのテスト修正

### Phase 2: Comments (7件)
- [ ] コメント基本操作（作成/編集/削除）のテスト修正
- [ ] 返信機能のテスト修正
- [ ] UUID バリデーションのテスト修正
- [ ] リアルタイム同期のテスト修正

### Phase 3: Kanban (3件)
- [ ] データ永続化のテスト修正
- [ ] ドラッグエラー復元のテスト修正
- [ ] 正規化ポジションのテスト修正

### Phase 4: Notifications (2件)
- [ ] テスト通知のテスト修正
- [ ] 既読処理のテスト修正

## 成果物

- [ ] `playwright-report-full-final.json` - 全テスト通過のレポート
- [ ] 各カテゴリの修正内容を記録
- [ ] 必要に応じてドキュメント更新

## 参考情報

- Essential テスト修正内容: `/docs/tickets/2025-10-26/02-playwright-test-report.md`
- テストガイドライン: `/docs/detail/testing.md`
