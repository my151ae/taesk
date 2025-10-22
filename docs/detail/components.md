# Component Structure

Taesk の UI ロジックは `app/(board)/_components/KanbanBoardClient.tsx` に集約されています。Phase 3でコラボレーション機能（コメント、通知、ボード共有）が追加され、新しいコンポーネントとZustandストアが導入されました。

## 1. トップレベル: `KanbanBoardClient`

- **場所**: `app/(board)/_components/KanbanBoardClient.tsx`
- **役割**: 認証済みユーザー向けの Kanban 体験を完全に提供（ボード切替、リスト & カード CRUD、ドラッグ＆ドロップ、オフライン同期、Realtime 連携、カードモーダル、通知）。
- **入力**: サーバーコンポーネントから渡される `initialBoard`, `initialData`, `initialCardId`
- **内部状態（抜粋）**:
  - `boards`, `currentBoardId`: ボードの選択状況
  - `boardData`: 現在のボードに紐づくリスト/カード（Supabase + localStorage キャッシュ）
  - `boardMembers`: 現在のボードのメンバーと権限（Phase 3）
  - `selectedCardId`, `cardModalStatus`: カードモーダル表示/状態管理
  - `lastBoardPathRef`, `modalReturnPathRef`: インターセプトされたモーダル遷移後に元の URL を復元するための履歴
  - `syncQueueStats`, `isOnline`: オフライン同期キューとネットワーク状態

### レンダリングツリー（一部省略）

```
KanbanBoardClient
├── ヘッダー
│   ├── ボードドロップダウン (board-menu)
│   │   └── 新規ボード作成
│   ├── 検索 & フィルター UI（タグ、優先度、担当者）
│   ├── NotificationsBell (Phase 3)
│   │   ├── タブ切替（All / Unread）
│   │   └── 通知リスト（ドロワー/モーダル）
│   ├── NotificationSettings (Phase 3)
│   │   ├── In-app notifications ON/OFF
│   │   ├── Web Push permissions & 購読管理
│   │   └── Quiet hours 設定
│   └── 同期ステータス表示（Live / Queued など）
├── DndContext (@dnd-kit)
│   ├── SortableContext (リスト横並び)
│   │   └── SortableList × N
│   │       ├── List header
│   │       │   ├── タイトル編集
│   │       │   └── メニュー（ShareDialog へのリンク含む）
│   │       ├── SortableContext (カード縦並び)
│   │       │   └── SortableCard × M
│   │       │       ├── タイトル、タグ、期限、優先度
│   │       │       └── 担当者アバター（複数対応）
│   │       └── 「+ Add Card」ボタン
│   └── 「+ Add List」ボタン
├── DragOverlay (ドラッグ中のプレビュー)
├── ShareDialog (Phase 3)
│   ├── メンバーリスト（role 表示・編集）
│   └── 招待フォーム（未実装）
└── CardModal (selectedCard がある場合のみ)
    ├── Details タブ
    │   ├── タイトル、説明、タグ、期限、優先度
    │   ├── 担当者選択（複数対応）
    │   └── ボード移動、削除
    └── Comments タブ (Phase 3)
        └── CommentsPanel
            ├── コメント一覧（スレッド表示）
            ├── コメント作成フォーム
            │   └── Mention コンポーネント（@メンション）
            └── 返信・編集・削除 UI
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
- **機能**: カード編集 UI（タイトル、説明、タグ、期限、優先度、複数担当者、ボード移動、リンクコピー、削除）
- **Phase 3 追加**: タブ切替（Details / Comments）
  - **Details タブ**: 従来のカード編集フォーム
  - **Comments タブ**: `CommentsPanel` コンポーネントを表示
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

## 6. Phase 3 コラボレーションコンポーネント

### `NotificationsBell`

- **場所**: `app/(board)/_components/NotificationsBell.tsx`
- **役割**: In-app通知センターの UI（ベルアイコン、未読バッジ、通知リスト）
- **特徴**:
  - タブ切替（All / Unread）
  - 通知リストをドロワー/モーダル形式で表示
  - 個別既読・一括既読機能
  - クリックでカード詳細へ遷移
- **状態管理**: `notifications-store.ts`（Zustand）を使用

### `NotificationSettings`

- **場所**: `app/(board)/_components/NotificationSettings.tsx`
- **役割**: 通知設定モーダル（In-app / Web Push / Quiet hours）
- **機能**:
  - In-app notifications ON/OFF
  - Web Push notification 許可リクエスト
  - Web Push 購読管理（購読解除ボタン）
  - Quiet hours 設定（開始時刻、終了時刻、タイムゾーン）
  - テスト通知送信
- **API 連携**: `GET/PUT /api/notifications/preferences`、`POST /api/notifications/test`

### `CommentsPanel`

- **場所**: `app/(board)/_components/CommentsPanel.tsx`
- **役割**: カードコメントのスレッド表示と編集 UI
- **機能**:
  - コメント一覧（スレッド形式、入れ子の返信表示）
  - コメント作成フォーム（`Mention` コンポーネント統合）
  - 返信、編集、削除ボタン
  - 楽観的 UI 更新（即座に画面反映 → Supabase 同期）
  - Realtime 購読（他ユーザーのコメントをリアルタイム反映）
- **状態管理**: `comments-store.ts`（Zustand）を使用

### `Mention`

- **場所**: `app/(board)/_components/Mention.tsx`
- **役割**: @メンション入力補完 UI
- **機能**:
  - `@` 入力時にボードメンバーのタイプアヘッド表示
  - キーボードナビゲーション（↑↓ / Enter / Esc）
  - メンション挿入時に `@[Full Name](uuid)` 形式でテキスト挿入
  - API: `GET /api/profiles/search?q=...`
- **使用場所**: `CommentsPanel` のコメント作成/編集フォーム

### `ShareDialog`

- **場所**: `app/(board)/_components/ShareDialog.tsx`
- **役割**: ボードメンバー管理 UI
- **機能**:
  - 現在のメンバー一覧（role 表示: owner / editor / commenter / viewer）
  - メンバーの role 変更（owner のみ）
  - メンバー削除（owner のみ）
  - 招待フォーム（UI あり、バックエンド未実装）
- **API 連携**: `GET/DELETE /api/boards/:boardId/members/:profileId`

## 7. Zustand ストア (Phase 3)

### `comments-store.ts`

- **場所**: `app/(board)/_stores/comments-store.ts`
- **責務**: コメントの状態管理、楽観的更新、オフラインキュー、Realtime 同期
- **主要メソッド**:
  - `fetchComments(cardId)`: コメント取得
  - `addComment(cardId, body, parentId, mentions)`: 新規コメント作成
  - `updateComment(commentId, body, mentions)`: コメント編集
  - `deleteComment(commentId)`: コメント削除（ソフトデリート）
  - `subscribeToComments(cardId)`: Supabase Realtime 購読
- **Realtime**: `postgres_changes` で `INSERT/UPDATE/DELETE` を監視し、リアルタイム反映

### `notifications-store.ts`

- **場所**: `app/(board)/_stores/notifications-store.ts`
- **責務**: 通知の状態管理、未読カウント、ポーリング
- **主要メソッド**:
  - `fetchNotifications()`: 通知一覧取得
  - `markAsRead(notificationId)`: 個別既読
  - `markAllAsRead()`: 一括既読
  - `startPolling()` / `stopPolling()`: 定期的な通知取得（15秒間隔）
- **未読カウント**: `unreadCount` を計算し、`NotificationsBell` のバッジに表示

---

### 参考リンク
- [`KanbanBoardClient.tsx`](../../app/(board)/_components/KanbanBoardClient.tsx)
- [`CardModal.tsx`](../../app/components/CardModal.tsx)
- [`CommentsPanel.tsx`](../../app/(board)/_components/CommentsPanel.tsx)
- [`NotificationsBell.tsx`](../../app/(board)/_components/NotificationsBell.tsx)
- [`comments-store.ts`](../../app/(board)/_stores/comments-store.ts)
- [`notifications-store.ts`](../../app/(board)/_stores/notifications-store.ts)
- [`lib/syncQueue.ts`](../../lib/syncQueue.ts)

最新の挙動と一致するよう、このドキュメントは 2025-10-23 (Phase 3 完了) の実装内容を反映しています。
