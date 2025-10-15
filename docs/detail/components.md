# Component Structure

Taesk の UI ロジックは `app/(board)/_components/KanbanBoardClient.tsx` に集約されています。ここではコンポーネント階層と主要な責務、重要なハンドラについて最新の実装に基づいて整理します。

## 1. トップレベル: `KanbanBoardClient`

- **場所**: `app/(board)/_components/KanbanBoardClient.tsx`
- **役割**: 認証済みユーザー向けの Kanban 体験を完全に提供（ボード切替、リスト & カード CRUD、ドラッグ＆ドロップ、オフライン同期、Realtime 連携、カードモーダル）。
- **入力**: サーバーコンポーネントから渡される `initialBoard`, `initialData`, `initialCardId`
- **内部状態（抜粋）**:
  - `boards`, `currentBoardId`: ボードの選択状況
  - `boardData`: 現在のボードに紐づくリスト/カード（Supabase + localStorage キャッシュ）
  - `selectedCardId`, `cardModalStatus`: カードモーダル表示/状態管理
  - `lastBoardPathRef`, `modalReturnPathRef`: インターセプトされたモーダル遷移後に元の URL を復元するための履歴
  - `syncQueueStats`, `isOnline`: オフライン同期キューとネットワーク状態

### レンダリングツリー（一部省略）

```
KanbanBoardClient
├── ヘッダー
│   ├── ボードドロップダウン (board-menu)
│   ├── 検索 & フィルター UI
│   └── 同期ステータス表示（Live / Queued など）
├── DndContext (@dnd-kit)
│   ├── SortableContext (リスト横並び)
│   │   └── SortableList × N
│   │       ├── List header（タイトル編集 / メニュー）
│   │       ├── SortableContext (カード縦並び)
│   │       │   └── SortableCard × M
│   │       └── 「+ Add Card」ボタン
│   └── 「+ Add List」ボタン
├── DragOverlay (ドラッグ中のプレビュー)
└── CardModal (selectedCard がある場合のみ)
```

### 主要ハンドラ

| ハンドラ | 目的 | 補足 |
|----------|------|------|
| `handleAddList` | 新規リスト作成 | Supabase へ upsert / オフライン時はキュー追加 |
| `handleAddCard` | 新規カード作成 | `createUniqueShortId` + `getNextIdShort` で card short ID を生成 |
| `handleSaveCard` | カード更新 | タイトル/説明/タグ/期限/優先度/アサイニー/スラッグを更新し Supabase へ同期 |
| `handleDeleteCard` | カード削除 | confirm → オフラインキュー or Supabase `delete` |
| `handleMoveCardToBoard` | 他ボードへカード移動 | カード移動後に対象ボードへ同期、モーダルを閉じる |
| `handleOpenCardModal` | カードクリック時のモーダル表示 | `router.push` で `/c/:shortId/...` へ遷移しつつ `selectedCardId` を更新 |
| `handleCloseCardModal` | モーダル閉鎖 | `router.back()` の結果 `/` へ落ちた際にも `lastBoardPathRef` を使って安全に元のボードへ戻す |
| `handleDragOver` / `handleDragEnd` | @dnd-kit 用のドラッグ処理 | オプティミスティック更新 → Supabase へ同期 |

### Realtime 連携

- `useEffect([currentBoardId])` 内で Supabase の `postgres_changes` を購読
- `realtimeChannelRef` と `token` を用いて重複購読や古いイベントを防止
- `React Strict Mode` 下では `useEffect` が 2 回呼ばれるため、`token` と `unsubscribe` ログ (`SUBSCRIBED` → `CLOSED`) がペアで発生するのは仕様
- カード/リスト更新は `setBoardData` でマージしつつローカルキャッシュも更新

## 2. リスト & カードのサブコンポーネント

`KanbanBoardClient.tsx` 内部で定義されているローカルコンポーネント。

### `SortableList`

- **責務**: 単一リストの表示、タイトル編集、「⋯」メニュー、カードのフィルタリング表示、カード追加ボタン
- **特徴**:
  - `useSortable` によるリスト並び替え
  - フィルター状態（検索 / タグ / 優先度 / 期限ソート）を `filterAndSortCards` で適用
  - メニュー開閉を `showMenu` + `document` クリックリスナーで制御

### `SortableCard`

- **責務**: 個別カードのドラッグ＆ドロップ、クリック時のモーダル遷移
- **特徴**:
  - `pointerdown/up` の座標差を監視し、ドラッグ閾値 (`CARD_CLICK_THRESHOLD`) 超過時はクリック扱いにしない
  - `allowNavigationRef` ＋ `isDraggingRef` でドラッグとクリックの競合を解決

### `CardModal`

- **場所**: `app/components/CardModal.tsx`
- **機能**: カード編集 UI（タイトル、説明、タグ、期限、優先度、担当者、ボード移動、リンクコピー、削除）
- **連携**: `onSave` → `handleSaveCard`、`onClose` → `handleCloseCardModal`
- **UI 補助**: `useEffect` によるフォーカストラップ、Escape キーでのクローズ、`data-autofocus` 対応

## 3. Intercepting Routes & モーダル

- **Intercept hook**: `app/(board)/@modal/(...)c/[short_id]/[[...slug]]/page.tsx`
  - 役割はモーダル表示中の `<body>` に `overflow-hidden` を付与/解除するのみ（UI はクライアント側）
- **Standalone page**: `app/c/[short_id]/[[...slug]]/page.tsx`
  - カード詳細の SSR 表示、メタデータ生成、ボードへの戻りリンクを提供

## 4. URL ナビゲーションのポイント

- `updateURL` は **1 回の `router.push/replace`** で canonical URL に遷移（以前の段階的な `/b/:sid` → `/b/:sid/:tail` 二度更新を解消）
- モーダルオープン時に `modalReturnPathRef` / `lastBoardPathRef` を記録し、モーダルクローズ後に確実に元のボードへ戻る
- `usePathname` のウォッチで `/c/` 以外へ遷移した場合は `selectedCardId` をリセットしモーダルを閉じる

## 5. オフライン同期とローカルキャッシュ

- `syncQueue.ts` と連携し、`navigator.onLine` に従って INSERT/UPDATE/DELETE をキューイング
- アプリ起動時およびオンライン復帰時に `syncQueue()` を実行し、`syncQueueStats` を UI に反映
- ローカルキャッシュは `localStorage`（キー: `kanban_board_data`）に保存、Supabase 読み込み失敗時のフェールオーバーとして利用

---

### 参考リンク
- [`KanbanBoardClient.tsx`](../../app/(board)/_components/KanbanBoardClient.tsx)
- [`CardModal.tsx`](../../app/components/CardModal.tsx)
- [`lib/syncQueue.ts`](../../lib/syncQueue.ts)

最新の挙動と一致するよう、このドキュメントは 2025-10-15 の実装内容を反映しています。
