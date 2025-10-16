# Storage Strategy

Taesk は **React state → localStorage → Supabase** の三層構造に、オフライン同期キューを組み合わせたハイブリッド構成を採用しています。

## レイヤー構成

```
React State (KanbanBoardClient)
    ↓  オプティミスティック更新
localStorage (`kanban_board_data`)
    ↓  ネットワーク状態を判定
Supabase (lists / cards / activity_logs)
    ↕  Supabase Realtime (postgres_changes)
syncQueue.ts (INSERT/UPDATE/DELETE)   ※ offline 時のみ
```

### 1. React State
- `boardData`（lists / cards）と各種 UI 状態を保持
- Supabase Realtime から届いたイベントで即時更新
- `updateData(newData)` が state + localStorage を同時に更新

### 2. localStorage
- キー: `kanban_board_data`
- 目的: オフライン時と Supabase 障害時のフェールオーバー
- 関数: `loadFromStorage()` / `saveToStorage()` (`KanbanBoardClient` 内で利用)

### 3. Supabase
- `loadFromSupabase(boardId)` で対象ボードの lists / cards を取得
- `syncToSupabase(boardData)` で upsert（オンライン時のみ）
- 削除は `supabase.from('cards').delete().eq('id', id)` のように個別クエリ

### 4. syncQueue.ts（オフライン同期）
- `addToSyncQueue({ type, table, data })` で localStorage にバッファリング
- `syncQueue()` がオンライン復帰時に順次処理
- UI には `syncQueueStats` とヘッダーのステータスバッジで表示（「Live」「Queued」など）

## 読み込みフロー

1. `KanbanBoardClient` 初期化
2. `loadFromSupabase(currentBoardId)` を実行
3. 成功した場合: `boardData` と localStorage を更新
4. 失敗した場合: `loadFromStorage()` の内容でレンダリング
5. `initializeDefaultLists()` がテストボード以外で空の場合に標準リストをシード

## 書き込みフロー

```
ユーザー操作 (追加 / 編集 / 削除 / ドラッグ) 
        ↓
ハンドラで newData を作成
        ↓
updateData(newData)   # React state + localStorage
        ↓
if (navigator.onLine)
    syncToSupabase(newData)
else
    addToSyncQueue({...})
```

### 代表的なハンドラ

```typescript
const handleAddCard = async (listId: string) => {
  if (!user || !currentBoardId) return;

  const shortId = await createUniqueShortId();
  const idShort = await getNextIdShort(currentBoardId);
  const newCard: Card = {
    id: uuidv4(),
    title: 'New Card',
    description: '',
    list_id: listId,
    board_id: currentBoardId,
    position: boardData.cards.filter(c => c.list_id === listId).length,
    user_id: getActualUserId(user.id),
    tags: [],
    due_date: null,
    priority: 'medium',
    assigned_to: null,
    assignee_id: null,
    short_id: shortId,
    id_short: idShort,
    slug: slugify('New Card'),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const newData = { ...boardData, cards: [...boardData.cards, newCard] };
  updateData(newData);

  if (isOnline) {
    await syncToSupabase(newData);
  } else {
    addToSyncQueue({ type: 'INSERT', table: 'cards', data: newCard });
  }
};
```

## Supabase Realtime

- `postgres_changes` を `lists` / `cards` テーブルで購読
- `realtimeChannelRef` + `token` で多重購読を防ぎ、Strict Mode 二回実行にも対応
- `handleDragOver` / `handleDragEnd` 後の upsert で別クライアントにも即座に反映

## Conflicts & 冪等性

- 更新は `upsert` を使用し冪等
- 競合が発生した場合は Realtime → `setBoardData` によって最新状態が上書きされる（最終更新勝ち）
- 将来的には `activity_logs` を活用した差分マージやバージョン管理を検討

## ベストプラクティス

- **オフライン時の連続操作**: `syncQueueStats.pending` が 0 に戻るまでアプリ上にバッジを表示
- **Playwright テスト**: `await page.waitForTimeout(...)` で Realtime 同期を考慮（詳細は `docs/detail/testing.md`）
- **localStorage 初期化**: テストで独自データを投入する際は `localStorage.removeItem('kanban_board_data')` を実施

---

最終更新日: 2025-10-15
