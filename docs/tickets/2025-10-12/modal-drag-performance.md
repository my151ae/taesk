# モーダル表示パフォーマンスとドラッグ操作の改善

**作成日**: 2025-10-12
**ステータス**: TODO
**優先度**: High
**担当**: Claude Code

## 問題の概要

### 🖥️ PC の問題
- モーダル表示までワンテンポ遅い（体感 100-300ms）
- 原因: `CardModalClient` で boards データ取得を待ってから表示している

### 📱 モバイルの問題
- 長押しでドラッグしようとするとモーダルが開いてしまう
- 原因: TouchSensor の 200ms delay が短すぎて、タップとドラッグの区別が不明確

## 期待する挙動（Trello 準拠）

### 🖥️ PC（マウス/トラックパッド）
- **クリック＋ドラッグ** → ドラッグのみ。**モーダルは開かない**
- **クリックして長押し（移動なし）→ マウスアップ** → **通常のクリック扱い**で**モーダルを開く**

### 📱 モバイル（タッチ）
- **タップ（短押し）** → **編集（カード詳細）を開く**
- **長押し** → **ドラッグ状態に入る**（"持ち上げる"）。**動かさなくてもモーダルは開かない**

## 実装方針

### 1. センサー設定の改善

**現状**:
```typescript
useSensor(PointerSensor, {
  activationConstraint: { distance: 8 }
}),
useSensor(TouchSensor, {
  activationConstraint: { delay: 200, tolerance: 8 }
})
```

**改善後**:
```typescript
useSensor(MouseSensor, {
  activationConstraint: { distance: 6 } // 5-8px で調整
}),
useSensor(TouchSensor, {
  activationConstraint: {
    delay: 350,      // 300-450ms に延長
    tolerance: 8     // 5-10px で調整
  }
}),
useSensor(KeyboardSensor, {
  coordinateGetter: sortableKeyboardCoordinates
})
```

**理由**:
- PC: `MouseSensor` + `distance` で微小なブレではドラッグにならず、クリックが即座に反応
- モバイル: `delay` を 300-450ms に延長して、短タップとの区別を明確化
- PointerSensor と Mouse/Touch の混在は非推奨（どちらかに統一）

### 2. ドラッグ中のクリック抑止ガード

**実装**:
```typescript
const isDraggingRef = useRef(false);

<DndContext
  onDragStart={() => { isDraggingRef.current = true; }}
  onDragEnd={() => { setTimeout(() => (isDraggingRef.current = false), 0); }}
  onDragCancel={() => { setTimeout(() => (isDraggingRef.current = false), 0); }}
>
```

**カードのクリックハンドラー**:
```typescript
const handleClick = (e: MouseEvent) => {
  if (isDraggingRef.current) return; // ドラッグ後の誤クリック抑止
  openModal();
}
```

**理由**:
- ドラッグ操作後に onClick が発火するのを防ぐ
- 次ティックで解除することでイベント順の競合を回避

### 3. モーダルの即時表示 + 中身は遅延取得

**現状の問題**:
```typescript
// CardModalClient.tsx
const [isLoading, setIsLoading] = useState(true);

useEffect(() => {
  // boards を取得してから isLoading を false に
  const loadBoards = async () => {
    const { data } = await supabase.from('boards').select('*');
    setBoards(data || []);
    setIsLoading(false); // ← ここまで待つ
  };
  loadBoards();
}, []);

if (isLoading) return null; // ← 表示されない
```

**改善案**:
```typescript
// オプション1: 即時表示 + Suspense
<Suspense fallback={<CardModalSkeleton />}>
  <CardModalContent card={card} />
</Suspense>

// オプション2: 親からデータを渡す
// (board)/page.tsx で boards を取得し、props で渡す

// オプション3: React Query でキャッシュ
const { data: boards } = useQuery({
  queryKey: ['boards'],
  queryFn: fetchBoards,
  staleTime: 5 * 60 * 1000, // 5分間キャッシュ
});
```

**理由**:
- クリック時点で即モーダルを開き、中でローディング表示
- ネットワーク待ちを UI ブロッキングしない
- 体感速度が大幅に改善

## 実装タスク

### Task 1: センサー設定の変更
- [ ] `PointerSensor` を `MouseSensor` に変更
- [ ] `MouseSensor` の distance を 6px に設定
- [ ] `TouchSensor` の delay を 350ms に延長
- [ ] `KeyboardSensor` を追加

### Task 2: ドラッグ中クリック抑止の実装
- [ ] `isDraggingRef` を追加
- [ ] `onDragStart/End/Cancel` で制御
- [ ] カードの `onClick` でガード処理

### Task 3: モーダル表示の最適化
- [ ] `CardModalClient` の `isLoading` ロジックを削除
- [ ] 即時表示 + Suspense/Skeleton 対応
- [ ] boards データ取得方法の最適化（キャッシュ or 親から渡す）

### Task 4: 動作確認
- [ ] PC: クリックでモーダル即表示
- [ ] PC: ドラッグ中はモーダル開かない
- [ ] モバイル: タップでモーダル即表示
- [ ] モバイル: 長押しでドラッグモード（モーダル開かない）
- [ ] E2E テスト更新

## 技術的な補足

### しきい値の目安
- **PC**: `distance: 5-8px`
- **モバイル**: `delay: 300-450ms`, `tolerance: 5-10px`

### 既知の落とし穴
1. **ほぼ動かしていないドラッグの後にクリックが走る**
   - → `isDraggingRef` + 次ティック解除で抑止

2. **delay 短すぎ問題（モバイル）**
   - → 300ms 以上を推奨（Trello 準拠）

3. **データ待ちでモーダルが遅い**
   - → 先に開く + 中で Suspense/ローディング

## 参考資料

- [Trello カード移動ドキュメント](https://support.atlassian.com/ja/trello/docs/moving-cards-or-lists/)
- [dnd-kit MouseSensor](https://next.dndkit.com/legacy/api-documentation/sensors/mouse)
- [dnd-kit TouchSensor](https://docs.dndkit.com/api-documentation/sensors/touch)
- [React Suspense でのデータフェッチ](https://blog.logrocket.com/react-suspense-data-fetching/)
- [ドラッグ後のクリック防止](https://stackoverflow.com/questions/64958986/react-how-to-prevent-execution-of-click-event-after-drag)

## 関連ファイル

- `app/(board)/page.tsx` - メインボードコンポーネント（センサー設定）
- `app/(board)/@modal/(.)c/[short_id]/[[...slug]]/CardModalClient.tsx` - モーダルクライアント
- `app/components/CardModal.tsx` - モーダルコンポーネント
- `e2e/kanban.spec.ts` - E2E テスト

## 完了条件

- [ ] PC でモーダルが即座に表示される（体感 < 50ms）
- [ ] PC でドラッグ中にモーダルが開かない
- [ ] モバイルでタップ時にモーダルが即座に表示される
- [ ] モバイルで長押し時にドラッグモードに入り、モーダルが開かない
- [ ] E2E テストがすべて通る
- [ ] コンソールエラー/警告がない
