# API Route 移行タスク

**作成日**: 2025-10-19
**優先度**: 🔴 高（セキュリティ＆設計統一）
**見積もり**: 3〜4時間

---

## 🎯 目的

Phase 1/2 で実装した**クライアント直接 Supabase アクセス**を、Phase 3 と同様に **API route 経由**に移行する。

### 現在の問題

1. **CORS エラー**: localhost から Supabase への直接アクセスがブロックされる
2. **セキュリティリスク**: クライアントに Supabase anon key が露出
3. **設計の不統一**: Phase 3 機能は API route、Phase 1/2 機能は直接アクセス
4. **RLS バイパスの可能性**: クライアント側で認証トークン操作可能

### 移行すべき箇所

現在、以下の箇所で直接 Supabase client を使用：

```typescript
// KanbanBoardClient.tsx 内
1. supabase.from('lists').select() - データ読み込み (172-173行)
2. supabase.from('activity_logs').insert() - アクティビティログ (207行)
3. supabase.from('lists').insert() - デフォルトリスト作成 (236行)
4. supabase.from('cards').upsert() - カード更新 (1191, 1197行)
5. supabase.from('lists').upsert() - リスト同期 (1222行)
6. supabase.from('lists').delete() - リスト削除 (1332行)
7. supabase.from('boards').insert() - ボード作成 (1527行)
8. supabase.from('cards').delete() - カード削除 (1698行)
```

---

## 📋 実装タスク

### Phase A: データ読み込み API（最優先）

**T1: GET /api/boards/[boardId]/data**
- **目的**: lists + cards を一度に取得
- **実装内容**:
  ```typescript
  // app/api/boards/[boardId]/data/route.ts
  export async function GET(request, { params }) {
    const { boardId } = await params;
    const supabase = await createServerSupabaseClient();

    // 認証チェック
    const { data: { user } } = await supabase.auth.getUser();

    // ボードメンバーか確認（RLS）
    const { data: lists } = await supabase
      .from('lists')
      .select('*')
      .eq('board_id', boardId)
      .order('position');

    const { data: cards } = await supabase
      .from('cards')
      .select('*')
      .eq('board_id', boardId)
      .order('position');

    return NextResponse.json({ lists, cards });
  }
  ```

- **クライアント側更新**:
  ```typescript
  // KanbanBoardClient.tsx: loadFromSupabase()
  const response = await fetch(`/api/boards/${boardId}/data`);
  const { lists, cards } = await response.json();
  ```

- **見積もり**: 30分
- **影響**: 🔴 CORS エラー解消（最重要）

---

### Phase B: リスト操作 API

**T2: POST /api/boards/[boardId]/lists**
- **目的**: リスト作成（デフォルトリスト含む）
- **実装**: `app/api/boards/[boardId]/lists/route.ts`
- **見積もり**: 20分

**T3: PUT /api/boards/[boardId]/lists/sync**
- **目的**: 複数リストの一括更新（同期処理）
- **実装**: `app/api/boards/[boardId]/lists/sync/route.ts`
- **見積もり**: 20分

**T4: DELETE /api/boards/[boardId]/lists/[listId]**
- **目的**: リスト削除
- **実装**: `app/api/boards/[boardId]/lists/[listId]/route.ts`
- **見積もり**: 15分

---

### Phase C: カード操作 API

**T5: POST /api/boards/[boardId]/cards**
- **目的**: カード作成
- **実装**: `app/api/boards/[boardId]/cards/route.ts`
- **見積もり**: 15分

**T6: PUT /api/boards/[boardId]/cards/[cardId]**
- **目的**: カード更新
- **実装**: `app/api/boards/[boardId]/cards/[cardId]/route.ts`
- **見積もり**: 20分

**T7: DELETE /api/boards/[boardId]/cards/[cardId]**
- **目的**: カード削除
- **実装**: `app/api/boards/[boardId]/cards/[cardId]/route.ts`
- **見積もり**: 15分

---

### Phase D: その他 API

**T8: POST /api/boards**
- **目的**: ボード作成
- **実装**: `app/api/boards/route.ts`
- **見積もり**: 20分

**T9: POST /api/boards/[boardId]/activity**
- **目的**: アクティビティログ作成
- **実装**: `app/api/boards/[boardId]/activity/route.ts`
- **見積もり**: 15分

---

### Phase E: クライアント側更新

**T10: KanbanBoardClient.tsx の全面更新**
- **実装内容**:
  - `loadFromSupabase()` → fetch `/api/boards/[boardId]/data`
  - `initializeDefaultLists()` → fetch POST `/api/boards/[boardId]/lists`
  - `syncToSupabase()` → fetch PUT `/api/boards/[boardId]/lists/sync`
  - `handleAddList()` → fetch POST `/api/boards/[boardId]/lists`
  - `handleDeleteList()` → fetch DELETE `/api/boards/[boardId]/lists/[listId]`
  - `handleSaveCard()` → fetch PUT `/api/boards/[boardId]/cards/[cardId]`
  - `handleDeleteCard()` → fetch DELETE `/api/boards/[boardId]/cards/[cardId]`
  - `handleAddBoard()` → fetch POST `/api/boards`
  - ログ記録 → fetch POST `/api/boards/[boardId]/activity`

- **見積もり**: 1時間
- **テスト**: 各機能の動作確認

---

### Phase F: テスト & 検証

**T11: E2E テスト更新**
- 既存の E2E テストが API route 経由でも動作するか確認
- 見積もり: 30分

**T12: 動作確認**
- リスト作成・編集・削除
- カード作成・編集・削除
- ドラッグ&ドロップ
- ボード切り替え
- オフライン同期
- 見積もり: 30分

---

## 📊 全体見積もり

| フェーズ | タスク数 | 見積もり |
|---------|---------|---------|
| Phase A | 1 | 30分 |
| Phase B | 3 | 55分 |
| Phase C | 3 | 50分 |
| Phase D | 2 | 35分 |
| Phase E | 1 | 60分 |
| Phase F | 2 | 60分 |
| **合計** | **12** | **約4時間30分** |

---

## 🎯 優先順位

### 今日中に実装すべき（CORS エラー解消）
1. ✅ **T1: GET /api/boards/[boardId]/data**（最優先）
   - CORS エラーを即座に解消
   - 30分程度

### 今週中に実装すべき
2. **T2-T9**: 残りの API routes
   - 段階的に移行
   - 各 API ごとにテスト

### 余裕があれば
3. **T10-T12**: 完全移行 & テスト

---

## ✅ 移行後のメリット

1. **セキュリティ向上**: サーバーサイドで認証・権限チェック
2. **CORS 問題解消**: 同一オリジン通信
3. **設計の統一**: 全機能が API route 経由
4. **監査ログ**: サーバーサイドでログ取得可能
5. **本番環境の安定性**: Vercel Edge Functions として最適化
6. **Phase 3 との整合性**: 全体的なアーキテクチャの統一

---

## 🔍 参考実装

Phase 3 で既に API route 経由で実装済み：
- `/api/boards/[boardId]/members` - メンバー管理
- `/api/comments/...` - コメント機能
- `/api/notifications` - 通知機能
- `/api/profiles/search` - ユーザー検索

これらと同じパターンで実装すればOK。

---

## 📝 実装方針

### 段階的移行
1. まず API route を作成
2. クライアント側で新 API を呼ぶように変更
3. 動作確認後、古いコード（直接 Supabase）を削除

### エラーハンドリング
- すべての API で適切なステータスコード返却
- クライアント側で 401/403/500 を適切に処理

### 後方互換性
- localStorage の既存データは引き続き動作するように

---

**作成者**: Claude Code
**レビュー待ち**: 松本様
**決定事項記録日**: 2025-10-19
