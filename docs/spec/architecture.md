# Architecture & Design (Timeline Edition)

Taesk のユーザー向け上位概念は Team であり、Board は Team 配下の作業単位です。本ドキュメントでは Team-first な入口、TimelineBoardPage を中心にした現在のアーキテクチャ、リアルタイム同期やメトリクス連携を含む全体構造を解説します。

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                        │
│  Next.js App Router (Server Components + Client Components)      │
│  • `/board` -> Team/Board bootstrap entry                        │
│  • Parallel Routes (@modal) for CardModal                        │
│  • AuthContext / NotificationSoundPlayer                         │
└───────────────────────────────┬──────────────────────────────────┘
                                │ Suspense + streaming SSR
┌───────────────────────────────▼──────────────────────────────────┐
│                        Timeline Application Layer                │
│  TimelineBoardPage (client)                                      │
│  • Header (team switcher, board selector, share, notifications)  │
│  • day_range timeline grid (24h, 1-7日)                          │
│  • A/B lists (YYYY-MM-DD_a/b)                                    │
│  • CardModal / CommentsPanel (parallel routes + Zustand)         │
│  Hooks: useTimelineData, useTimelineFiltering, useTimelineDragAndDrop │
└───────────────────────────────┬──────────────────────────────────┘
                                │ TimelineResponse (days/events/ab)
┌───────────────────────────────▼──────────────────────────────────┐
│                       API + Server Utilities                     │
│  • GET /api/boards/:id/timeline (start/range + A/B buckets)      │
│  • POST /api/cards/* (shared CRUD endpoints)                     │
│  • Metrics: createClientTrace('timeline'), createServerTrace()   │
│  • Supabase Realtime subscriptions (cards/comments)              │
└───────────────────────────────┬──────────────────────────────────┘
                                │ Supabase JS clients (SSR/browser)
┌───────────────────────────────▼──────────────────────────────────┐
│                         Supabase (PostgreSQL)                    │
│  • Tables: boards, board_members, cards, lists, comments, ...    │
│  • Timeline fields on cards: due_start/due_end/due_bucket/...    │
│  • Realtime (postgres_changes)                                   │
│  • RLS policies per board_id + profile_id                        │
└──────────────────────────────────────────────────────────────────┘
```

### Timeline Response Contract

- `days`: JST ISO 日付 (`{ key: 'YYYY-MM-DD', label, isoDate }`)
- `events`: `due_date` + `due_start` + `due_end` が揃うカード。`due_date`, `due_start`, `due_end`, `durationMinutes`, `tags`, `checked`, `due_bucket`, `due_bucket_position`, `assignee_id`, `assignee_ids`, `assigned_to`, `short_id`, `slug` を含む
- `abBuckets`: `${isoDate}_a` / `${isoDate}_b` のキーで配列を保持。`due_bucket_position` で降順ソートし、`assignee_ids` を含めて返却
- `serverNow`: API 生成時刻 (UTC ISO)。クライアントは JST に変換して Now ラインを描画

`GET /api/boards/[boardId]/timeline` は Team 配下の Board member のみアクセス可能。最終的な認可判定の正本は `board_members` で、未登録ユーザーは 403、未認証は 401 となる。

## Timeline UI Composition

```
app/layout.tsx
└── app/(board)/layout.tsx
    ├── AuthContext + NotificationSoundPlayer
    ├── @modal parallel route (card modal intercept)
    └── Slot
        └── app/board/page.tsx
            └── TimelineBoardPage (client)
                ├── Header
                │   ├── Team switcher + board selector (fetch `/api/teams`, `/api/boards`)
                │   ├── ShareDialog / NotificationSettings / ProfileSettings
                │   ├── Filters/SearchBar (useTimelineFiltering)
                │   └── Status indicators (realtimeStatus)
                ├── DesktopTimelineView / MobileTimelineView
                │   ├── DaySection (per day)
                │   │   ├── TimelineColumn (hour axis + events)
                │   │   └── TimelineDayBucket (A/B lists)
                │   └── DragOverlay + PointerPreview
                ├── CardModal (useSearchParams + @modal route)
                └── CommentsPanel (Zustand store, `useCommentsStore`)
```

`TimelineBoardPage` は巨大なクライアントコンポーネントだが、責務ごとに以下のフックへ委譲している:

- `useTimelineUrlState` … URL 由来の表示範囲/日付の同期
- `useTimelineBoardController` … timeline/list 切替、list window preset、anchor date/offset の制御
- `useTimelineData` … Timeline API 取得・Realtime 反映・オンライン状態の保持
- `useTimelineBoardViewModels` … desktop/mobile の panel・toolbar・body props 組み立て
- `useTimelineViewport` … ヘッダー高さ/表示領域/現在時刻の算出
- `useTimelineFiltering` … 検索・タグ・優先度のフィルタ（内部で `useBoardFilters`）
- `useTimelineNavigation` … 日付移動/範囲変更の制御
- `useTimelineCalendar` … 外部カレンダーの取得と表示
- `useTimelineDragAndDrop` … DnD/リサイズ/プレビュー状態
- `useTimelineCardActions` … CardModal 保存や新規作成の処理

画面描画は `TimelineBoardPage` が直接抱えず、`TimelineBoardScreen` に grouped props を渡す構成へ寄せている。desktop/mobile の最終 JSX は view 側に残しつつ、画面 wiring と render 前計算の境界を分ける方針を採っている。

## Data Flow

1. **Server-side boot**  
   `app/board/page.tsx` が `/board` を Team/Board bootstrap 入口として扱い、最後に使った Board、または先頭アクセス可能 Board、未所属時は default Team + default Board を解決して `<TimelineBoardPage initialBoard={board} />` を描画。

2. **Client hydration & initial fetch**  
   `TimelineBoardPage` が `fetch('/api/boards/:id/timeline')` を呼び、`setData(TimelineResponse)` で `days/events/abBuckets` をメモリへ保持。ロード中は skeleton、失敗時は `errorMessage` を表示。

3. **Realtime subscription**  
   `useRealtimeBoard` が `supabase.channel` を作成し、`postgres_changes` で `cards` / `comments` の INSERT/UPDATE/DELETE を購読。`handleCardChange` がイベント配列と `abBuckets` を即時更新する。

4. **User interaction**  
   - Timeline での DnD / resize → `handleDragStart` / `handleDragMove` / `handleDragEnd` / `handleResize*`  
     `useTimelineDragAndDrop` は内部で drag session と resize をまとめて扱い、`pointerPreview`、bucket indicator、A/B hover 状態を導出する。確定時は `useTimelineCardActions` の `applyPatch` を通じて `PATCH /api/boards/:id/cards/:id` を実行し、失敗時はロールバックする。
   - CardModal での編集 → `PATCH /api/cards/:id` を呼び、成功レスポンスをローカル状態へ反映（タイトル/タグ/期日/`assignee_ids` 等）。リアルタイム通知とも整合するため再フェッチは原則不要。
   - CommentsPanel → `useCommentsStore` がコメントをローカルで挿入し、API へ送信する。エラー時は store 側の retry 情報を保持する。

5. **Rollback / retry**  
   Timeline の mutation は `applyPatch` を通して楽観更新し、失敗時はロールバックとエラー表示で収束させる。D&D 完了後に一律再フェッチする前提ではなく、ローカル状態と API 応答の整合を優先する。

6. **Metrics**  
   `createClientTrace('timeline')` が `traceRef` に格納され、ページロードや DnD 操作ごとに `traceRef.current?.addEvent('drag_end', payload)` のように記録。アンマウント時に `traceRef.current?.flush()` が呼ばれ、`test-results/batches/*` に含まれる `dumpClientMetrics` で取得可能。

## Hooks & Stores

### useRealtimeBoard
- `useRealtimeBoard(boardId, callbacks)` は Supabase ブラウザクライアントを生成し、`postgres_changes` で以下を購読:
  - `cards` テーブル (board_id フィルタ) → `callbacks.onCardChange(payload)` を呼び、Timeline UI へ差分反映
  - `comments` テーブル → `callbacks.upsertComment` / `callbacks.removeComment`
- `realtimeStatus` を返しており、接続中/切断/エラーを UI に表示可能。

### useTimelineBoardViewModels
- `TimelineBoardPage` が保持する state と handler から、desktop/mobile の panel・toolbar・body props をまとめる。
- `TimelineBoardScreen` に渡す grouped props の土台であり、page 本体に JSX ごとの細かい wiring を残さない。
- render 前計算は shared helper へ逃がしつつ、view 固有 interaction は各 view に残す。

### useTimelineDragAndDrop
- helper 分割済みの pointer/autoscroll/drop/persist を束ねる orchestrator。
- 公開 state は `activeDrag`, `pointerPreview`, `activeResize`, `bucketIndicator`, `isOverABList` だが、内部では drag session / interaction state へ寄せる前提で整理を進めている。
- Timeline と A/B の drop、event resize、drag overlay 用の導出値を 1 箇所で管理する。

### useTimelineFiltering
- `searchQuery`, `sortBy`, `showFilters` を管理し、共通 board 表示向けの `events` / `abBuckets` / `overdue` を返す。
- 内部で `useBoardFilters` を利用し、`availableTags` / `tagSummaries` / `hasActiveFilters` などの補助情報も返す。
- 左パネルごとの専用 state はここへ混ぜず、`Tag` の選択状態は右パネル Tag 表示専用として別管理する。

### useCommentsStore
- コメントとそのローカルキュー (`comment-queue`) を Zustand で管理。
- `upsertComment` / `removeComment` アクションは Realtime からも呼ばれ、別タブの投稿が即座に反映される。

## Drag & Drop Lifecycle

1. `TimelineBoardScreen` / `MobileTimelineView` が `DndContext` を初期化し、Timeline 用 collision detection を適用する。
2. `handleDragStart` が drag session を開始し、対象カードや開始位置 (`originColumn`, `originBucket`, `originMinutes`) を保存する。
3. `handleDragMove` が pointer helper と drop helper を使って候補を判定し、`pointerPreview`、bucket indicator、A/B hover を更新する。
4. `handleDragEnd` が drop target を解析:
   - Timeline へのドロップ → `due_start`/`due_end` を座標から再計算
   - A/B へのドロップ → `due_bucket` をターゲットから取得し、`due_bucket_position` を算出
   - 不正なドロップ or キャンセル → `previousData` を戻し、`activeDrag` を解除
5. 成功した変更は `applyPatch` で API へ反映し、成功レスポンスか realtime 差分で収束させる。失敗時はロールバックする。

## Modal & Routing

- `app/(board)/@modal/(...)c/[short_id]/[[...slug]]/page.tsx` が intercepting modal と standalone page の両方を担当。
- Timeline 上でカードをクリックすると `router.push('?card=SHORTID')` を行い、parallel route が `CardModal` を描画。URL を直接開いた場合も同じモーダルが表示される。
- `CardModal` 内では `due_start`, `due_end`, `due_bucket`, `assignee_ids` などを編集可能。保存成功時はレスポンスをローカル状態へ即時反映し、`assignee_ids` を保持したままリアルタイム通知を待つ。
- `CommentsPanel` は `CardModal` からタブ切り替えで開き、`useCommentsStore` 経由で投稿/削除/Realtime 反映を行う。

## Metrics & Observability

- `createClientTrace('timeline')` … `TimelineBoardPage` の `traceRef` から `addEvent` を呼び出し、`flush()` で `POST /api/metrics` に送信。Playwright では `dumpClientMetrics(page, ['timeline'])` で抽出し、`docs/tickets/` に貼り付ける。
- `createServerTrace('timeline')` … API ルートやサーバーユーティリティから呼び出し、Timeline API のレスポンス時間やエラー率を JSON に記録。
- Playwright JSON の `.stats` は `jq` で集計する（例: `sed -n '/^{/,$p' test-results/batches/<file>.json | jq '.stats'`）。詳細な失敗の再実行は `scripts/test-rerun-failed.sh` を利用する。

## Sequence Diagrams

### CardModal Save (assignee_ids を含む)

```mermaid
sequenceDiagram
  participant UI as CardModal
  participant State as Timeline state
  participant API as PATCH /api/boards/:id/cards/:id
  participant RT as Supabase Realtime

  UI->>State: Optimistic merge (title/tags/due_*/assignee_ids)
  UI->>API: PATCH cards
  API-->>RT: postgres_changes (card row)
  RT-->>State: handleCardChange merges (assignee_ids preserved)
  State-->>UI: Modal re-renders with updated card
```

### Drag & Drop (Timeline ⇄ A/B)

```mermaid
sequenceDiagram
  participant UI as TimelineView
  participant DnD as useTimelineDragAndDrop
  participant State as Timeline state
  participant API as PATCH /api/boards/:id/cards/:id
  participant RT as Supabase Realtime

  UI->>DnD: handleDragEnd(cardId, target)
  DnD->>State: persistPlacement (bucket/start/end, keep assignee_ids)
  DnD->>API: PATCH cards
  API-->>RT: postgres_changes
  RT-->>State: handleCardChange (assignee_ids retained)
```

### Realtime Update (別タブで変更された場合)

```mermaid
sequenceDiagram
  participant RT as Supabase Realtime
  participant State as Timeline state
  participant UI as TimelineView/CardModal

  RT-->>State: onCardChange(payload)
  State-->>UI: setData (events/abBuckets with assignee_ids)
  UI-->>User: Renders updated tags/due/assignees without refetch
```

## Error Handling & Offline Strategy

- Timeline fetch 失敗時は `setStatus('error')` と `setErrorMessage()` を通じてリトライ UI を表示。
- Realtime 切断時は `realtimeStatus.state === 'error'` をヘッダーで警告。ユーザーには `Reconnect` ボタンを提供。
- CardModal 保存や DnD 更新が API エラーになった場合、エラー表示とロールバックで収束させる。Timeline の mutation 成功後に一律再フェッチする設計ではない。

## Supabase Schema Highlights

- `cards` テーブルに Timeline 用カラムを追加:
  - `due_start` / `due_end` (time without time zone, 1 分単位)
  - `due_bucket` (`a` | `b`)
  - `due_bucket_position` (numeric, 降順で並べ替え)
- Team は Board の上位コンテナとして存在し、Board access は Team 配下で成立する。
- 実際の Board 単位アクセス制御は `board_members` を正本として行い、全 API ルートが RLS で保護される。
- ただし `board_members` は Team member に限定され、Board access 作成前に Team membership が必要になる。
- Realtime は `cards`, `comments`, `notifications` を購読。TimelineBoardPage では `cards` と `comments` のみ使用。

Canonical type definitions: `lib/api-types/timeline.ts`（TimelineResponse/TimelineEvent/TODAY/TOMORROW の契約を統一）

## Testing Touchpoints

- `e2e/timeline.spec.ts` が `TimelineBoardPage` の最重要経路を検証:
  - サーバー側で `ensureBoardFixtures()` を実行し、Timeline 用のカードを Supabase へ直接投入
  - `/board` へアクセスし、`data-testid="timeline-event"` が描画されることを確認
  - `dumpClientMetrics(page, ['timeline'])` でクライアントメトリクスを取得
- Comments/Notifications/Permissions など他 spec も Timeline 前提で CardModal やヘッダー機能を操作する。

この構成により、Timeline UI は Kanban 遺産に依存せずに Today/Tomorrow 計画と A/B リスト管理を一体的に提供し、リアルタイム更新やオフライン耐性、メトリクス可観測性を兼ね備えています。
