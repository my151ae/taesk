# A/Bリストのドロップインジケーター改善 (2025-11-25)

## 実施した変更

### 1. カードの上下にドロップラインを表示

**ファイル**: `TimelineBucketCard.tsx`

- カードを上下2つのドロップゾーンに分割
- 上半分にホバー: 上部にラインを表示（カードの前に挿入）
- 下半分にホバー: 下部にラインを表示（カードの後に挿入）
- ドロップゾーンに`pointer-events-none`を追加してボタンクリックを妨げないように修正

**コード**:
```tsx
const { setNodeRef: setTopRef, isOver: isOverTop } = useDroppable({
    id: `bucket-item-top:${bucketKey}:${item.card_id}`,
    data: { type: 'bucket-item-top', bucketKey, cardId: item.card_id },
});

const { setNodeRef: setBottomRef, isOver: isOverBottom } = useDroppable({
    id: `bucket-item-bottom:${bucketKey}:${item.card_id}`,
    data: { type: 'bucket-item-bottom', bucketKey, cardId: item.card_id },
});

// Drop Zones (pointer-events-none)
<div ref={setTopRef} className="absolute top-0 left-0 right-0 h-1/2 z-20 pointer-events-none" />
<div ref={setBottomRef} className="absolute bottom-0 left-0 right-0 h-1/2 z-20 pointer-events-none" />

// Indicators
{isOverTop && <div className="absolute left-0 right-0 top-0 h-0.5 bg-sky-500 z-30" />}
{isOverBottom && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-sky-500 z-30" />}
```

---

### 2. ドロップロジックの更新

**ファイル**: `useTimelineDragAndDrop.ts`

- `bucket-item-top`と`bucket-item-bottom`の2つの新しいドロップタイプを追加
- `bucket-item-top`: ターゲットカードの前に挿入（前のカードとターゲットの中間位置）
- `bucket-item-bottom`: ターゲットカードの後に挿入（ターゲットと次のカードの中間位置）

**コード**:
```ts
if (overType === 'bucket-item-top') {
    // Insert before target
    const prevItem = bucketItems[targetIndex - 1];
    if (prevItem?.bucketPosition != null && targetItem.bucketPosition != null) {
        bucketPosition = (prevItem.bucketPosition + targetItem.bucketPosition) / 2;
    } else if (targetItem.bucketPosition != null) {
        bucketPosition = targetItem.bucketPosition + 1;
    } else {
        bucketPosition = Date.now();
    }
} else {
    // Insert after target
    const nextItem = bucketItems[targetIndex + 1];
    if (targetItem.bucketPosition != null && nextItem?.bucketPosition != null) {
        bucketPosition = (targetItem.bucketPosition + nextItem.bucketPosition) / 2;
    } else if (targetItem.bucketPosition != null) {
        bucketPosition = targetItem.bucketPosition - 1000;
    } else {
        bucketPosition = Date.now();
    }
}
```

---

### 3. 空リストのドロップインジケーター

**ファイル**: `TimelineBuckets.tsx`

- `DroppableBucket`をレンダープロップパターンに変更
- 空リストにホバー時、リストの上部（最初のカードが追加される位置）に青いラインを表示

**コード**:
```tsx
const DroppableBucket = ({ children, bucketKey, disabled }: { 
    children: (isOver: boolean) => ReactNode; 
    bucketKey: string; 
    disabled?: boolean 
}) => {
    const { setNodeRef, isOver } = useDroppable({ 
        id: `bucket-drop:${bucketKey}`, 
        data: { type: 'ab-bucket', bucketKey } 
    });
    return (
        <div ref={setNodeRef} className={!disabled && isOver ? 'bg-slate-100/50' : ''}>
            {children(isOver)}
        </div>
    );
};

// Usage
<DroppableBucket key={section.bucket} bucketKey={section.bucket} disabled={status === 'loading'}>
    {(isOver) => (
        <div className={`border border-slate-100 bg-slate-50/70 p-3 shadow-inner ${isA ? 'min-h-[160px]' : ''}`}>
            {items.length === 0 && isOver && (
                <div className="mb-2 h-0.5 bg-sky-500" />
            )}
            {/* ... */}
        </div>
    )}
</DroppableBucket>
```

---

### 4. A/Bリストの高さ調整

**ファイル**: `TimelineBuckets.tsx`

- Aリストの初期高さを約4枚分（160px）に設定
- ドロップターゲットとして認識しやすくなった

**コード**:
```tsx
const isA = section.bucket.endsWith('_a');
<div className={`... ${isA ? 'min-h-[160px]' : ''}`}>
```

---

### 5. 横スクロール防止

**ファイル**: `TimelineBoardPage.tsx`, `TimelineGrid.tsx`, `TimelineBuckets.tsx`

- スクロールコンテナに`overscroll-x-none`を追加
- グリッドに`w-full`を追加
- `TimelineGrid`のラッパーに`overflow-x-hidden`を追加

**コード**:
```tsx
// TimelineBoardPage.tsx
<div className="... overflow-x-hidden overscroll-x-none ..." />

// TimelineGrid.tsx
<div className="relative overflow-x-hidden">
    <div className="grid w-full" ...>

// TimelineBuckets.tsx
<div className="grid w-full" ...>
```

---

### 6. A/Bリストの位置固定（試行中）

**ファイル**: `TimelineBuckets.tsx`

- `flex justify-end`から`absolute right-0`に変更
- コンテナに`min-w-[210px] flex-shrink-0`を追加

**コード**:
```tsx
<div key={day.key} className="relative">
    <div className="pointer-events-auto w-[210px] min-w-[210px] flex-shrink-0 absolute right-0">
        {renderAbCard(day)}
    </div>
</div>
```

---

## 未解決の問題

### A/Bリストが左にズレる問題

**現象**: A/Bリストのカードをドラッグすると、A/Bリストの枠（中身）が左にスライドする

**試した対策**:
1. ✗ コンテナに`w-full`を追加
2. ✗ コンテナに`min-w-[210px] flex-shrink-0`を追加
3. ✗ `scrollbar-gutter: stable`を追加（右端に隙間ができた）
4. ✗ `flex justify-end`から`absolute right-0`に変更

**次の調査方向**:
- DraggableCardのtransform適用時にレイアウトが変わっている可能性
- グリッドのカラム幅計算が影響している可能性
- 他の要素（例：タイムライングリッド）との相互作用

---

## 動作確認済みの機能

- ✓ カードの上半分にホバー時、上部にラインが表示される
- ✓ カードの下半分にホバー時、下部にラインが表示される
- ✓ 空リストにホバー時、上部にラインが表示される
- ✓ ドロップ位置に応じて正しく挿入される
- ✓ カードのボタンをクリックしてモーダルが開く
- ✓ Aリストの高さが適切
- ? 横スクロールが発生しない（部分的に改善）
