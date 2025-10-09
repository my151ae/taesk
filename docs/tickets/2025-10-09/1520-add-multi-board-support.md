# Ticket #1520: マルチボード機能の追加

**作成日**: 2025-10-09
**ステータス**: 検討中
**優先度**: 高（E2Eテスト改善に必要）

## 背景

現在、Taeskは単一の共有ボードのみをサポートしています。これにより以下の問題が発生しています：

1. **E2Eテストの問題**: テストが本番データベースのデータをクリーンアップする必要があり、本番データを破壊するリスクがある
2. **将来的な拡張性**: ユーザーが複数のプロジェクトやチームで異なるボードを使いたい場合に対応できない

## 目的

- テスト用ボードと本番ボードを分離し、安全にE2Eテストを実行できるようにする
- 将来的な機能拡張として、ユーザーが複数のボードを作成・管理できる基盤を構築する

## 提案する機能

### 1. データベーススキーマの変更

#### 新規テーブル: `boards`

```sql
CREATE TABLE boards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  is_test_board BOOLEAN DEFAULT false,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーは全てのボードを閲覧可能（共有ボード）
CREATE POLICY "Authenticated users can view all boards"
ON boards FOR SELECT
TO authenticated
USING (true);

-- Anon users can view all boards (for testing)
CREATE POLICY "Anon users can view all boards"
ON boards FOR SELECT
TO anon
USING (true);

-- 認証済みユーザーはボードを作成可能
CREATE POLICY "Authenticated users can insert boards"
ON boards FOR INSERT
TO authenticated
WITH CHECK (true);

-- Anon users can insert boards (for testing)
CREATE POLICY "Anon users can insert boards"
ON boards FOR INSERT
TO anon
WITH CHECK (true);

-- 認証済みユーザーは全てのボードを編集可能（共有ボード）
CREATE POLICY "Authenticated users can update all boards"
ON boards FOR UPDATE
TO authenticated
USING (true);

-- Anon users can update all boards (for testing)
CREATE POLICY "Anon users can update all boards"
ON boards FOR UPDATE
TO anon
USING (true);

-- 認証済みユーザーは全てのボードを削除可能（共有ボード）
CREATE POLICY "Authenticated users can delete all boards"
ON boards FOR DELETE
TO authenticated
USING (true);

-- Anon users can delete all boards (for testing)
CREATE POLICY "Anon users can delete all boards"
ON boards FOR DELETE
TO anon
USING (true);

-- Realtime有効化
ALTER PUBLICATION supabase_realtime ADD TABLE boards;
```

#### 既存テーブルの変更: `lists` と `cards`

```sql
-- board_id カラムを追加
ALTER TABLE lists ADD COLUMN board_id UUID REFERENCES boards(id) ON DELETE CASCADE;
ALTER TABLE cards ADD COLUMN board_id UUID REFERENCES boards(id) ON DELETE CASCADE;

-- 既存データのマイグレーション（後述）
-- インデックス追加
CREATE INDEX idx_lists_board_id ON lists(board_id);
CREATE INDEX idx_cards_board_id ON cards(board_id);
```

### 2. UI/UX 変更

#### ヘッダー部分
```
[Taesk Board ▼]  [接続状態]  [test@example.com]  [Sign Out]
  ↓
  - Main Board
  - Test Board
  - + New Board
```

#### ボード切り替え
- ドロップダウンメニューでボード選択
- 選択したボードIDをReact stateまたはURL paramsで管理
- ボード切り替え時にデータを再読み込み

#### ボード作成ダイアログ
```
┌─────────────────────────────┐
│ Create New Board            │
├─────────────────────────────┤
│ Board Name: [_____________] │
│ Description (optional):     │
│ [_________________________] │
│                             │
│         [Cancel] [Create]   │
└─────────────────────────────┘
```

### 3. 実装の詳細

#### フロントエンド変更

**新しいstate管理**
```typescript
const [currentBoardId, setCurrentBoardId] = useState<string | null>(null);
const [boards, setBoards] = useState<Board[]>([]);
```

**データ取得の変更**
```typescript
// Before
const { data } = await supabase.from('lists').select('*');

// After
const { data } = await supabase
  .from('lists')
  .select('*')
  .eq('board_id', currentBoardId);
```

**Realtime subscriptionの変更**
```typescript
// board_id でフィルタリング
.on('postgres_changes', {
  event: '*',
  schema: 'public',
  table: 'lists',
  filter: `board_id=eq.${currentBoardId}`
}, (payload) => { ... })
```

#### バックエンド/マイグレーション

**既存データのマイグレーション手順**
1. デフォルトボード "Main Board" を作成
2. 既存の全 lists と cards に board_id を設定
3. board_id を NOT NULL に変更

```sql
-- Step 1: デフォルトボードを作成
INSERT INTO boards (id, name, description, is_test_board, user_id)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Main Board',
  'Default board for all existing data',
  false,
  NULL
);

-- Step 2: 既存データにboard_idを設定
UPDATE lists SET board_id = '00000000-0000-0000-0000-000000000001' WHERE board_id IS NULL;
UPDATE cards SET board_id = '00000000-0000-0000-0000-000000000001' WHERE board_id IS NULL;

-- Step 3: board_id を NOT NULL に変更
ALTER TABLE lists ALTER COLUMN board_id SET NOT NULL;
ALTER TABLE cards ALTER COLUMN board_id SET NOT NULL;
```

### 4. テスト対応

#### テスト用ボードの作成

```typescript
// E2Eテストのsetup
test.beforeAll(async () => {
  // テスト用ボード作成
  const { data: testBoard } = await supabase
    .from('boards')
    .insert({
      name: 'E2E Test Board',
      is_test_board: true,
      user_id: null
    })
    .select()
    .single();

  testBoardId = testBoard.id;
});
```

#### テスト後のクリーンアップ

```typescript
test.afterAll(async () => {
  // テスト用ボードを削除（CASCADE により lists/cards も自動削除）
  await supabase
    .from('boards')
    .delete()
    .eq('id', testBoardId);
});
```

または、全テスト用ボードを一括削除：

```typescript
// すべてのテスト用ボードを削除
await supabase
  .from('boards')
  .delete()
  .eq('is_test_board', true);
```

### 5. 型定義の更新

```typescript
// lib/supabase.ts
export interface Board {
  id: string;
  name: string;
  description?: string;
  is_test_board: boolean;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface List {
  id: string;
  title: string;
  position: number;
  board_id: string;  // 追加
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  list_id: string;
  board_id: string;  // 追加
  position: number;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}
```

## 実装手順

### Phase 1: データベースマイグレーション
1. `boards` テーブル作成
2. `lists` と `cards` に `board_id` カラム追加
3. RLS policies 設定
4. デフォルトボード "Main Board" 作成
5. 既存データのマイグレーション
6. Realtime有効化

### Phase 2: フロントエンド（基本機能）
1. Board型定義とstate管理追加
2. デフォルトボード読み込みロジック
3. データ取得時に `board_id` フィルタ追加
4. CRUD操作時に `board_id` を含める
5. Realtime subscriptionに `board_id` フィルタ追加

### Phase 3: フロントエンド（UI）
1. ボード切り替えドロップダウン実装
2. ボード作成ダイアログ実装
3. ボード編集機能（名前変更）
4. ボード削除機能（確認ダイアログ付き）

### Phase 4: テスト改善
1. E2Eテストでテスト用ボード作成
2. テスト後のクリーンアップ実装
3. 全E2Eテストが通ることを確認

## 懸念事項とリスク

### 1. 既存データのマイグレーション
- **リスク**: 本番環境でマイグレーション失敗すると既存データが破損
- **対策**:
  - ローカル環境で十分にテスト
  - マイグレーション前にバックアップ
  - Supabase Studioでマイグレーション状況を確認

### 2. パフォーマンス
- **懸念**: board_id フィルタによるクエリ性能への影響
- **対策**:
  - インデックス追加済み（`idx_lists_board_id`, `idx_cards_board_id`）
  - Realtime subscriptionもboard_idでフィルタリング

### 3. 後方互換性
- **懸念**: 既存のlocalStorageデータにboard_idが含まれていない
- **対策**:
  - localStorage読み込み時にboard_idを補完
  - または、マイグレーション後にlocalStorageをクリア

## 代替案

### A. Supabase Branch（却下）
- **メリット**: 完全に分離されたDB環境
- **デメリット**:
  - Pro plan以上が必要（月額$25〜）
  - 追加コスト
  - ローカル開発環境のセットアップが複雑

### B. テスト専用テーブル（却下）
- **メリット**: 実装が簡単
- **デメリット**:
  - コードが複雑になる（`test_lists` vs `lists`）
  - 将来的な拡張性がない
  - Realtime subscriptionも二重管理が必要

### C. マルチボード機能（採用）
- **メリット**:
  - テスト分離とアプリ機能拡張を同時に実現
  - 追加コストなし
  - 将来的な拡張性が高い
- **デメリット**:
  - 実装工数が多い
  - 既存データのマイグレーションが必要

## 成功基準

- [ ] 既存の本番データが全て "Main Board" に移行されている
- [ ] ボード切り替えUIが動作する
- [ ] 新しいボードを作成できる
- [ ] ボードを削除できる（Main Board以外）
- [ ] E2Eテストがテスト用ボードで実行される
- [ ] E2Eテスト後にテストデータが自動削除される
- [ ] 全E2Eテスト（12個）が通る
- [ ] Realtime syncがボード切り替え後も正常に動作する
- [ ] 本番環境でもマルチボードが正常に動作する

## 参考資料

- [Supabase RLS Policies](https://supabase.com/docs/guides/auth/row-level-security)
- [Supabase Realtime Filters](https://supabase.com/docs/guides/realtime/postgres-changes#filters)
- [PostgreSQL Foreign Keys](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK)

## 備考

- この機能により、将来的に「個人ボード」「チームボード」などの拡張も容易になる
- `is_test_board` フラグを使って、定期的なクリーンアップジョブも実装可能
- ボード単位で権限管理を追加することも将来的に可能
