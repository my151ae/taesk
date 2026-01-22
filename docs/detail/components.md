# Component Structure (Timeline Board)

Taesk の UI は `app/(board)/_components/timeline/TimelineBoardPage.tsx` を中心に構築されています。旧 Kanban コンポーネントは残っていますが参照用であり、実際の画面はすべて TimelineBoardPage とそのサブコンポーネントで描画されます。

## 1. TimelineBoardPage（トップレベル）

- **場所**: `app/(board)/_components/timeline/TimelineBoardPage.tsx`
- **役割**: Today/Tomorrow の Timeline ビューと A/B リストを描画し、カードモーダル・コメント・通知 UI をまとめて制御する。
- **主な state**:
  - `data`: `TimelineResponse` (`days`, `events`, `abBuckets`, `serverNow`)
  - `status` / `errorMessage`: API 読み込み状態
  - `activeDrag`, `pointerPreview`: DnD 中のプレビュー/メタ情報
  - `liveNowMinutes`, `liveNowIsoDate`: JST に変換した現在時刻
  - `availableBoards`: ボード切り替え用リスト
  - `modalCard`, `cardModalStatus`, `modalProfiles`: CardModal のロード状態
  - `searchQuery`, `selectedTags`, `selectedPriority`, `sortBy`, `showFilters`, `filteredData`, `hasActiveFilters`, `availableTags`: `useTimelineFiltering`（内部で `useBoardFilters`）で管理
  - `realtimeStatus`: `useTimelineData` 経由で `useRealtimeBoard` が提供

### 描画構造（抜粋）

```
TimelineBoardPage
├── Header
│   ├── Board Menu (board picker + Sign out)
│   ├── SearchBar + Filter toggles (useTimelineFiltering)
│   ├── Metrics: realtimeStatus
│   ├── Actions
│   │   ├── ShareDialog
│   │   ├── NotificationsBell
│   │   ├── NotificationSettings
│   │   └── ProfileSettings
│   └── Timeline meta (Live badge, date range, JST clock)
├── DesktopTimelineView / MobileTimelineView
│   ├── DaySection (1日分)
│   │   ├── TimelineColumn (hour axis + events)
│   │   └── TimelineDayBucket (A/B lists)
│   └── DragOverlay + PointerPreview
├── CardModal + CommentsPanel (parallel route)
└── Toasts / inline errors
```

### Header

- ボード選択: `/api/boards` から取得したリストをフライアウトとして表示。`signOut` ボタンも同じメニュー内に配置。
- フィルター: `useTimelineFiltering` の状態を双方向バインドし、タグ・優先度・ソート順を切り替えると Timeline / A/B のレンダリング内容が更新される。
- 通知関連: `NotificationsBell` と `NotificationSettings` は `app/(board)/_components/` 配下の共通コンポーネントをそのまま利用。Timeline ヘッダー内にモーダルを開く導線を提供する。
- Sync インジケーター: 現状は `realtimeStatus` のみを表示。

### Timeline (DaySection + TimelineColumn)

- `getDisplayHours` と `minuteToPixels` で 1 日分のキャンバスを描画。
- `data-testid="timeline-grid"` はスクロール領域のコンテナに付与し、E2E の安定待機に利用。
- `Live` ラインは `serverNow` を JST へ変換 (`getIsoDateJst`, `getNowMinutesJst`) し、Today カラム内で赤い水平線として描画。
- イベント要素 (`timeline-event`) のスタイル:
  - 高さ: `durationMinutes` の長さに応じて最低値を確保（デスクトップは 20px 以上、モバイルは 10px 以上）
  - ラベル: タイトル、タグ、優先度、チェック状態
  - クリックで CardModal を開く（`handleOpenCardModal`）

### A/B Lists

- `AB_CARD_META` により Today/Tomorrow の 2 グループを定義し、各グループに `sections` (A/B) を持たせている。
- `useTimelineFiltering` が `events` と `abBuckets` をまとめてフィルタし、タグ/優先度検索に合わせて表示リストを更新。
- ドラッグ対象として `useDroppable` を設定し、 `bucketPosition` を使って降順ソート。

### CardModal & CommentsPanel

- `CardModal` は `app/components/CardModal.tsx` を再利用。Timeline 特有の `due_channel`, `due_start`, `due_end`, `due_bucket`, `due_bucket_position` を編集できるようにフォーム項目を拡張済み。
- Modal 打ち上げパス:  
  1. `Card` をクリック → `router.push('?card=SHORTID')`  
  2. `cardModalShortIdRef` に short_id を保持  
  3. useEffect で URL 変更を監視し、`CardModal` を描画  
- コメントタブ (`CommentsPanel`) は `useCommentsStore` で状態管理。Timeline でも Kanban 時代の機能をそのまま提供。

## 2. Drag & Drop 関連コンポーネント

### Pointer Preview

- `pointerWithin` / `rectIntersection` を併用したカスタムコリジョン検出を採用。`pointerPreview` state には現在の座標、対象列/バケット、スナップ後の時間が格納される。
- Timeline 上をドラッグしている間は 15 分刻みで補助グリッドを塗り、A/B セクションへ移動するとリスト単位のハイライトに切り替える。

### Active Drag State

```ts
interface ActiveDragState {
  id: UniqueIdentifier;
  source: 'timeline' | 'ab';
  sourceBucket?: DueBucket;
  originMinutes?: number;        // start/end のコピー
  originChannel: DueChannel;
  originCard: Card;
  pointerOffset: { x: number; y: number; };
  originalPosition: DOMRect | null;
}
```

`activeDragRef` に保存した値を `handleDragEnd` で参照し、エラー時は `previousData` に戻す。これにより 1 回の DnD 操作から複数の最小変更セット（channel/bucket/start/end）を再計算できる。

## 3. 共通コンポーネント

### ShareDialog / Notifications / ProfileSettings

- すべて `app/(board)/_components/` 直下の実装を再利用。Timeline 専用の props は不要で、`TimelineBoardPage` から必要な状態 (`initialBoard`, `availableBoards`, `user`) を渡す。
- ShareDialog は `boardMembers` API へアクセスし、role 変更やメンバー削除を行う。
- NotificationSettings は `NotificationSoundPlayer` と連携し、音声アンロック/テスト音再生に加えて quiet hours や Web Push 購読を制御する。

### CommentsPanel / Mention

- Timeline でも Kanban と同一のコメント UI を提供。`Mention` コンポーネントは @入力時に `GET /api/profiles/search` を叩き、`@[Full Name](uuid)` 形式で挿入。
- `useCommentsStore` が localStorage (`comment-queue`) に pending コメントを保持し、オンライン復帰時に再送する。

## 4. Hooks & Stores

| Hook / Store | 役割 | 主な戻り値 |
| --- | --- | --- |
| `useTimelineFiltering` | 検索・タグ・優先度・並び順を管理。Timeline と A/B を同時にフィルタ。 | `searchQuery`, `selectedTags`, `selectedPriority`, `setSortBy`, `filteredData`, `hasActiveFilters`, `availableTags` |
| `useRealtimeBoard(boardId, callbacks)` | Supabase Realtime (cards/comments) を購読し、差分を UI に反映 | `{ realtimeStatus }` |
| `useSyncQueue()` | オフラインキュー (`taesk-sync-queue`) を監視し、オンライン状態と統計を返す | `{ isOnline, syncQueueStats }` |
| `useCommentsStore()` | コメントリストと pending キューを管理。Realtime からの upsert/delete も反映 | `fetchComments`, `upsertComment`, `removeComment`, `pendingCount` |

## 5. Routing & Modal Flow

- `app/(board)/@modal/(...)c/[short_id]/[[...slug]]/page.tsx` が intercepting モーダルを担当。Timeline から `router.push('?card=SHORTID')` すると parallel route が `CardModal` を描画し、背景の Timeline は維持される。
- `app/c/[short_id]/[[...slug]]/page.tsx` はスタンドアロンのカード詳細ページ。Timeline とは別に SSR され、OG 情報や share URL の正規化を行う。
- `buildBoardUrl(initialBoard)` は `short_id`/`slug` を考慮した canonical URL を生成し、`usePathname` で監視している。

## 6. Notifications & Audio

- `NotificationSoundPlayer` が `window.addEventListener('taesk:notification-received', ...)` を使って音声再生を制御。Timeline ヘッダーの `NotificationSettings` からアンロックとテスト再生を行う。
- 通知ベル (`NotificationsBell`) は未読件数をヘッダーにオーバーレイ表示し、クリックでドロワーを開く。Timeline でも Kanban 時代と同じ UX を維持。

## 7. 状態永続化

- TimelineBoardPage 自体は localStorage を直接利用しないが、`useSyncQueue` と `useCommentsStore` が `taesk-sync-queue` / `comment-queue` を管理している。コメント投稿はローカルキューを保持し、オンライン復帰時に再送する。
- `availableBoards` や Timeline レンダリング状態はメモリ内のみに保持し、ページ再読み込み時は `fetch('/api/boards/:id/timeline')` を再度実行して整合性を保つ。

Timeline コンポーネント群は以上の構造で連携し、Today/Tomorrow 計画、A/B タスク整理、カードコメント、通知設定を一体化した体験を提供します。
