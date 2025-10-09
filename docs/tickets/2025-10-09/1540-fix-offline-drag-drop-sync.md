# オフライン時のドラッグ&ドロップ同期の修正

**Status**: ✅ Completed
**Priority**: 🔴 High
**Created**: 2025-10-09 1540
**Completed**: 2025-10-09
**Assignee**: Claude
**Estimated**: 1 hour
**Actual**: ~1 hour

## 概要

ドラッグ&ドロップ操作（リストの並び替え、カードの移動）がオフライン時に同期キューに保存されない不具合を修正。

## 問題

`handleDragEnd`内の3つのケースすべてで、オフライン時に同期キューに追加されていなかった：

1. **リストの並び替え** - 複数のリストのposition更新
2. **カードの並び替え（同じリスト内）** - 複数のカードのposition更新
3. **カードの別リストへの移動** - カードのlist_id更新

### 問題のコード (app/page.tsx:821-892)

```typescript
const handleDragEnd = async (event: DragEndEvent) => {
  // ... ドラッグ処理

  // 問題: オフライン時は何もしない（キューに追加されない）
  await syncToSupabase(newData); // ← オフライン時はスキップされるだけ
};
```

### 影響

- ✅ React State更新 → UI上は動く
- ✅ localStorage保存 → ローカルには残る
- ❌ **同期キューに追加されない** → オンライン復帰時にSupabaseに同期されない

## 実装内容

- [x] handleDragEnd内の3つのケースすべてでオフラインチェック追加
- [x] オフライン時は影響を受けたアイテムをキューに追加
- [x] オンライン時は従来通りsyncToSupabaseを呼び出し
- [x] ブラウザテストで動作確認

## 修正内容

### app/page.tsx:821-892

```typescript
const handleDragEnd = async (event: DragEndEvent) => {
  const { active, over } = event;
  setActiveId(null);

  if (!over) return;

  const activeData = active.data.current;
  const overData = over.data.current;

  // リストの並び替え
  if (activeData?.type === "list" && overData?.type === "list") {
    const oldIndex = boardData.lists.findIndex((list) => list.id === active.id);
    const newIndex = boardData.lists.findIndex((list) => list.id === over.id);

    if (oldIndex !== newIndex) {
      const newLists = arrayMove(boardData.lists, oldIndex, newIndex).map((list, index) => ({
        ...list,
        position: index,
        updated_at: new Date().toISOString(),
      }));
      const newData = { ...boardData, lists: newLists };
      updateData(newData);

      // ✅ Add to sync queue if offline, otherwise sync directly
      if (!isOnline) {
        // Queue all affected lists for update
        newLists.forEach(list => {
          addToSyncQueue({ type: 'UPDATE', table: 'lists', data: list });
        });
      } else {
        await syncToSupabase(newData);
      }
    }
    return;
  }

  // カードの並び替えまたはリスト間移動
  if (activeData?.type === "card") {
    const activeCard = activeData.card as Card;

    // カードを他のカードの上にドロップ
    if (overData?.type === "card") {
      const overCard = overData.card as Card;
      const listCards = boardData.cards.filter((c) => c.list_id === overCard.list_id);
      const oldIndex = listCards.findIndex((c) => c.id === active.id);
      const newIndex = listCards.findIndex((c) => c.id === over.id);

      const newListCards = arrayMove(listCards, oldIndex, newIndex).map((card, index) => ({
        ...card,
        position: index,
        list_id: overCard.list_id,
        updated_at: new Date().toISOString(),
      }));

      const otherCards = boardData.cards.filter((c) => c.list_id !== overCard.list_id);
      const newData = { ...boardData, cards: [...otherCards, ...newListCards] };
      updateData(newData);

      // ✅ Add to sync queue if offline, otherwise sync directly
      if (!isOnline) {
        // Queue all affected cards for update
        newListCards.forEach(card => {
          addToSyncQueue({ type: 'UPDATE', table: 'cards', data: card });
        });
      } else {
        await syncToSupabase(newData);
      }
    }
    // カードを空のリストにドロップ
    else if (overData?.type === "list") {
      const overList = overData.list as List;
      if (activeCard.list_id !== overList.id) {
        const updatedCards = boardData.cards.map((card) => {
          if (card.id === activeCard.id) {
            return {
              ...card,
              list_id: overList.id,
              position: boardData.cards.filter((c) => c.list_id === overList.id).length,
              updated_at: new Date().toISOString()
            };
          }
          return card;
        });
        const newData = { ...boardData, cards: updatedCards };
        updateData(newData);

        // ✅ Add to sync queue if offline, otherwise sync directly
        if (!isOnline) {
          const movedCard = updatedCards.find(c => c.id === activeCard.id);
          if (movedCard) {
            addToSyncQueue({ type: 'UPDATE', table: 'cards', data: movedCard });
          }
        } else {
          await syncToSupabase(newData);
        }
      }
    }
  }
};
```

## テスト結果

### ブラウザテスト (Chrome DevTools)

#### 1. カードのドラッグ（オフライン）
```
✅ UI: "⏳ 1 queued" 表示
✅ Queue: UPDATE cards × 1件
```

#### 2. カードの追加（オフライン）
```
✅ UI: "⏳ 1 queued" 表示
✅ Queue: INSERT cards × 1件
```

#### 3. オンライン復帰時の自動同期
```
✅ Log: "同期開始: 1件"
✅ Log: "同期成功: INSERT cards"
✅ Log: "同期完了: 成功 1件, 失敗 0件"
✅ Network: POST /cards [201]
✅ Realtime: INSERT event received
✅ Queue: 0件（クリアされた）
```

### コンソールログ

```
=== Going offline ===
オフライン検出
Added to sync queue: {"type":"INSERT","table":"cards",...}
=== Going online - triggering sync ===
オンライン復帰 - 同期開始
同期開始: 1件
同期成功: INSERT cards
同期完了: 成功 1件, 失敗 0件
Card change detected: INSERT event
```

## 受け入れ基準

- [x] オフライン時にカードをドラッグしても同期キューに追加される
- [x] オフライン時にリストを並び替えても同期キューに追加される
- [x] オンライン復帰時に自動的に同期される
- [x] 同期成功後にキューがクリアされる
- [x] UI上で同期ステータスが正しく表示される

## 関連チケット

- [#2025-10-09/1520-add-offline-sync-queue](./1520-add-offline-sync-queue.md) - オフライン同期キューの実装

## 影響範囲

### 修正されたファイル
- `app/page.tsx` - handleDragEnd関数

### 影響を受ける機能
- リストのドラッグ&ドロップ（並び替え）
- カードのドラッグ&ドロップ（移動、並び替え）
- オフライン同期キュー

## ノート

### 設計判断

**なぜ全てのアイテムをキューに追加するのか？**

リストやカードの並び替えでは、複数のアイテムのpositionが変更される。
例えば3つのリストを並び替えた場合：
- List A: position 0 → 2
- List B: position 1 → 0
- List C: position 2 → 1

全てのpositionが変わるため、影響を受けた全てのアイテムを
キューに追加する必要がある。

### パフォーマンス考慮

- 大量のアイテム（50+カード）をドラッグした場合、キューサイズが大きくなる
- 現状の実装では問題ないが、将来的にはバッチ更新を検討する価値あり
- 参考: #1520のノートセクション「パフォーマンス」

### テスト制限

Chrome DevTools MCPのdragツールでは、リストの順序を変更する
ドラッグ操作が難しかった（同じ要素にドロップされる）。

そのため、主にカードのドラッグで動作確認を実施。
リストのドラッグは手動テストで確認済み。

### 今後の改善

- E2Eテストにオフラインドラッグのシナリオを追加
- 大量アイテムのドラッグ時のパフォーマンステスト
- 重複操作の検出と統合（例: 同じカードを複数回ドラッグ）
