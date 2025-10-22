# Architecture & Design

## System Architecture

### High-Level Overview

```
┌──────────────────────────────────────────────────────────┐
│                      Presentation Layer                  │
│  ┌────────────────────────────────────────────────────┐  │
│  │         Next.js App Router (Server + Client)      │  │
│  │                                                    │  │
│  │  • Server Components (SSR/SSG)                    │  │
│  │  • Client Components (Interactive UI)            │  │
│  │  • API Routes (boards, comments, notifications)  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│                    Application Layer                      │
│  ┌─────────────────────┐    ┌─────────────────────────┐  │
│  │  React Components   │    │  State Management       │  │
│  │                     │    │                         │  │
│  │  • KanbanBoardClient │   │  • React useState       │  │
│  │  • SortableList     │    │  • Zustand stores       │  │
│  │  • SortableCard     │    │    (comments, notifs)   │  │
│  │  • CommentsPanel    │    │  • useSensor            │  │
│  │  • NotificationsBell│    │  • useSortable          │  │
│  └─────────────────────┘    └─────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│                      Business Logic                       │
│  ┌──────────────────────────────────────────────────┐    │
│  │           Event Handlers & State Management      │    │
│  │                                                  │    │
│  │  Board Operations:                               │    │
│  │  • handleAddList / handleAddCard                │    │
│  │  • handleEditList / handleEditCard              │    │
│  │  • handleDeleteList / handleDeleteCard          │    │
│  │  • handleDragStart / handleDragOver / End       │    │
│  │  • updateData (local state + cache + sync)      │    │
│  │                                                  │    │
│  │  Collaboration (Phase 3):                        │    │
│  │  • comments-store: addComment, updateComment    │    │
│  │  • notifications-store: markAsRead, polling     │    │
│  │  • Realtime subscriptions (cards/comments)      │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│                      Data Layer                           │
│  ┌─────────────────────┐    ┌──────────────────────┐     │
│  │   Local Storage     │    │    Supabase          │     │
│  │                     │    │                      │     │
│  │  • Cache            │    │  • PostgreSQL DB     │     │
│  │  • Offline support  │◄──►│  • REST API          │     │
│  │  • Fast reads       │    │  • Realtime          │     │
│  │                     │    │    (cards/lists/     │     │
│  │                     │    │     comments)        │     │
│  │                     │    │  • Edge Functions    │     │
│  │                     │    │    (Web Push)        │     │
│  └─────────────────────┘    └──────────────────────┘     │
└──────────────────────────────────────────────────────────┘
```

## Design Patterns

### 1. **Hybrid Storage Pattern**

```typescript
// Pattern: Write-through cache with async sync
const updateData = (newData: BoardData) => {
  // Step 1: Update React state (immediate UI update)
  setBoardData(newData);

  // Step 2: Update cache (for offline/reload)
  saveToStorage(newData);

  // Step 3: Sync to cloud (async, don't block UI)
  // Called separately by each handler
};

const syncToSupabase = async (data: BoardData) => {
  // Upsert to Supabase (idempotent)
  await supabase.from('lists').upsert(data.lists);
  await supabase.from('cards').upsert(data.cards);
};
```

**Benefits**:
- Instant UI feedback
- Works offline
- Data persists across reloads
- Multi-device sync when online

### 2. **Optimistic UI Pattern**

User action → Update UI → Save locally → Sync to cloud

```
[User clicks "Add Card"]
      ↓
[Update boardData state]  ← Instant UI update
      ↓
[Save to localStorage]    ← Cache for reload
      ↓
[Sync to Supabase]       ← Background, async
```

If sync fails, data still in localStorage for retry.

### 3. **Compound Component Pattern**

```typescript
// Parent manages all state
<KanbanBoard>
  {/* Children receive data via props */}
  <SortableList>
    <SortableCard />
  </SortableList>
</KanbanBoard>
```

- **KanbanBoard**: Main container, holds all state
- **SortableList**: Display logic for a list
- **SortableCard**: Display logic for a card

All mutations flow up to KanbanBoard via callbacks.

### 4. **Controlled Components Pattern**

```typescript
// Card editing example
const [isEditing, setIsEditing] = useState(false);
const [title, setTitle] = useState(card.title);

// Controlled inputs
<input value={title} onChange={(e) => setTitle(e.target.value)} />

// On save, propagate up to parent
onEdit(card.id, title, description);
```

## Component Architecture

### Component Tree

```
app/layout.tsx
└── app/(board)/layout.tsx   # @modal parallel route
    └── KanbanBoardClient    # Client-side UI shell
        ├── Header
        │   ├── Board selector & create
        │   ├── Search & filters
        │   ├── NotificationsBell (Phase 3)
        │   ├── NotificationSettings (Phase 3)
        │   └── Sync status
        ├── DndContext (@dnd-kit)
        │   ├── SortableContext (lists)
        │   │   └── SortableList × N
        │   │       ├── List header & menu (rename/delete, ShareDialog)
        │   │       ├── SortableContext (cards)
        │   │       │   └── SortableCard × M
        │   │       │       └── Multi-assignee avatars (Phase 3)
        │   │       └── "+ Add Card" button
        │   └── "+ Add List" button
        ├── DragOverlay
        ├── ShareDialog (Phase 3)
        └── CardModal (selectedCardId が存在する場合)
            ├── Details tab
            └── Comments tab (Phase 3)
                └── CommentsPanel
                    └── Mention component
```

### Data Flow

```
User Action (e.g. add card / drag card / edit card)
        ↓
Optimistic update in KanbanBoardClient (React state)
        ↓
Persist to localStorage (offline cache)
        ↓
Supabase sync
    ├─ Online: 直接 upsert / delete
    └─ Offline: syncQueue に enqueue → 後で自動再送
```

Realtime 経由の外部更新は `postgres_changes` → `setBoardData` でローカル状態にマージされ、UI とキャッシュが即時更新されます。

## State Management

### State Structure

**Board Data** (React State):
```typescript
interface BoardData {
  lists: List[];
  cards: Card[];
}

interface List {
  id: string;           // UUID
  title: string;
  position: number;     // For ordering
  created_at: string;
  updated_at: string;
}

interface Card {
  id: string;           // UUID
  title: string;
  description: string;
  list_id: string;      // Foreign key to List
  assignee_ids: string[]; // Multiple assignees (Phase 3)
  position: number;     // For ordering within list
  tags: string[];
  due_date: string | null;
  priority: 'low' | 'medium' | 'high';
  created_at: string;
  updated_at: string;
}
```

**Collaboration Data** (Zustand Stores - Phase 3):
```typescript
// comments-store.ts
interface CommentsStore {
  comments: CommentWithAuthor[];
  fetchComments: (cardId: string) => Promise<void>;
  addComment: (cardId: string, body: string, mentions: string[]) => Promise<void>;
  subscribeToComments: (cardId: string) => void;
}

// notifications-store.ts
interface NotificationsStore {
  notifications: Notification[];
  unreadCount: number;
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  startPolling: () => void;
}
```

### State Updates

**Board data** lives in `KanbanBoardClient` component:

```typescript
const [boards, setBoards] = useState<Board[]>(initialBoard ? [initialBoard] : []);
const [currentBoardId, setCurrentBoardId] = useState(initialBoard?.id ?? MAIN_BOARD_ID);
const [boardData, setBoardData] = useState<BoardData>(initialData ?? { lists: [], cards: [] });
const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);  // Phase 3
const [activeId, setActiveId] = useState<string | null>(null);
const [selectedCardId, setSelectedCardId] = useState<string | null>(initialCardId ?? null);
const [cardModalStatus, setCardModalStatus] = useState<'loading' | 'ready' | 'error'>(initialCardId ? 'ready' : 'loading');
const [isOnline, setIsOnline] = useState(true);
```

Updates always follow this pattern:
1. Create new data object
2. Call `updateData(newData)`
3. `updateData` → `setBoardData` + `saveToStorage`
4. Separately call `syncToSupabase(newData)`

**Comments & Notifications** use Zustand stores for:
- Optimistic updates
- Offline queue
- Realtime synchronization
- Global state (accessible from any component)

## Drag & Drop Architecture

### dnd-kit Setup

```typescript
<DndContext
  sensors={sensors}
  collisionDetection={closestCorners}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
>
  {/* Sortable items */}
</DndContext>
```

### Event Flow

```
User starts drag
    ↓
onDragStart: setActiveId(dragged item)
    ↓
onDragOver: Update positions optimistically (visual only)
    ↓
User releases
    ↓
onDragEnd: Calculate final positions, save to DB
    ↓
DragOverlay cleared
```

### Collision Detection

- **Lists**: Horizontal sorting strategy
- **Cards**: Vertical sorting strategy
- **Algorithm**: `closestCorners` (default)

Works well for both touch and mouse input.

## Mobile-First Considerations

### Touch Sensors

```typescript
useSensor(TouchSensor, {
  activationConstraint: {
    delay: 350,        // Long-press to drag (aligns with CARD_CLICK_THRESHOLD)
    tolerance: 8,      // Forgive small movements
  },
})
```

**Why**: Distinguishes drag from scroll on mobile.

### Responsive Layout

- Lists: `w-72 md:w-80` (narrower on mobile)
- Padding: `p-4 md:p-8` (less padding on mobile)
- Scroll area: Extends to screen edges with `-mx-4 px-4`

### PWA Optimizations

- Installable manifest
- Offline support via localStorage
- Touch-optimized button sizes
- No hover states (mobile doesn't hover)

## Performance Considerations

### Optimizations

1. **No unnecessary re-renders**
   - Memoize sorted lists/cards only when needed
   - Use stable IDs (UUIDs) for React keys

2. **Efficient DB queries**
   - Upsert instead of delete + insert
   - Batch operations when possible
   - Cascade deletes (DB handles it)

3. **Lazy loading**
   - useState with lazy initializer
   - Load from Supabase on mount, not render

### Future Improvements

- [ ] Virtual scrolling for large lists
- [ ] Debounce sync to Supabase
- [ ] React.memo for Card/List components
- [ ] Service Worker for true offline mode
- [x] Real-time subscriptions (Supabase Realtime) - **完了 (2025-10-22)**

## Comments & Notifications Architecture

### Overview (Phase 3 - 2025-10-22)

コメント機能と通知システムはリアルタイム同期とオフライン対応を備えた協働機能です。

```
User posts comment
      ↓
Zustand Store (optimistic update)
      ↓
API Route (/api/cards/[cardId]/comments)
      ↓
Supabase Insert (comments table)
      ↓
Notification Generation (lib/server/notifications.ts)
      ↓
Supabase Realtime → All connected clients
      ↓
UI updates automatically
```

### Comments State Management

**Zustand Store** (`app/(board)/_stores/comments-store.ts`):
- 楽観更新（Optimistic UI）
- オフラインキュー（Offline Queue）
- エラーハンドリング（Error Handling）

```typescript
interface CommentsStore {
  comments: CommentWithAuthor[];
  // CRUD operations with optimistic updates
  createComment: (cardId: string, body: string, mentions: string[]) => Promise<void>;
  updateComment: (id: string, body: string) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
  // Realtime sync
  syncComment: (comment: CommentWithAuthor) => void;
}
```

### Mentions System

**UUID-based Tokenization** (`<@uuid>` format):
1. UI では `@DisplayName` として表示
2. テキストエリアには `@DisplayName<@uuid>` として挿入
3. サーバー送信時に UUID を抽出して `mentions` 配列へ
4. サーバーで UUID 形式検証 + ボードメンバー確認
5. 表示時は `RenderCommentBody` で安全に変換

### Notification Generation

**Trigger Points**:
- コメント作成時（`comment_created` または `comment_replied`）
- メンション作成時（`mention`）

**Recipients** (`lib/server/notifications.ts:resolveCommentRecipients`):
- カード作成者（`cards.user_id`）
- 担当者（`cards.assignee_id`）
- 過去のコメント参加者（`comments.author_id`）
- メンション対象者（`mentions` 配列）
- **除外**: 送信者自身

**Deduplication**:
- `notifications.dedupe_key` で重複防止（UNIQUE 制約）
- 形式: `{type}:{recipient_id}:{comment_id}:{card_id}`

### Realtime Subscriptions

**Cards & Lists** (`KanbanBoardClient.tsx:1055-1102`):
```typescript
supabase
  .channel('board-changes')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'cards',
    filter: `board_id=eq.${currentBoardId}`,
  }, handleCardChange)
  .subscribe();
```

**Comments** (`KanbanBoardClient.tsx:1103-1141`):
```typescript
supabase
  .channel('comments-changes')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'comments',
  }, (payload) => {
    // Zustand store に同期
    useCommentsStore.getState().syncComment(payload.new);
  })
  .subscribe();
```

### Card Modal Routing (Interim Solution)

**Background**:
- Next.js 15 の Intercepting Routes に `router.back()` バグあり
- 暫定的に `?card=<card_id>` クエリパラメータで対応

**Implementation** (`KanbanBoardClient.tsx:195-239`):
```typescript
// URL 更新
const openCardModal = (cardId: string) => {
  const url = new URL(window.location.href);
  url.searchParams.set('card', cardId);
  window.history.pushState({}, '', url);
  setSelectedCardId(cardId);
};

// 初期化時に ?card= を検出
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const cardId = params.get('card');
  if (cardId) {
    setSelectedCardId(cardId);
  }
}, []);
```

**Future**:
- Next.js のバグ修正後、`/c/[short_id]/[[...slug]]` Intercepting Routes に復帰予定
- 参考: `docs/detail/routing.md`

### Permission-Based Access Control

**Role Hierarchy** (`board_members.role`):
- `owner`: 完全なアクセス
- `editor`: コメント投稿可能
- `commenter`: コメント投稿可能
- `viewer`: 読み取り専用（コメントフォーム非表示）

**Implementation** (`CommentsPanel.tsx:106-121`):
```typescript
const [userRole, setUserRole] = useState<MemberRole | null>(null);

// Fetch user role
useEffect(() => {
  const fetchRole = async () => {
    const res = await fetch(`/api/boards/${boardId}/members/me`);
    const data = await res.json();
    setUserRole(data.role);
  };
  fetchRole();
}, [boardId]);

// Hide form for viewer
{!editingId && userRole === 'viewer' && (
  <div>閲覧専用の権限のため、コメントを投稿できません。</div>
)}
```

### Notifications Architecture (Phase 3)

**In-App Notifications**:
- Zustand Store (`notifications-store.ts`)で状態管理
- 15秒ポーリングで新規通知を取得
- `NotificationsBell` UIで表示（All / Unread タブ）
- 未読カウント表示

**Web Push Notifications**:
```
1. User grants permission (NotificationSettings UI)
2. Service Worker registers (public/sw.js)
3. Browser subscription created (VAPID keys)
4. Store in push_subscriptions table
5. When notification created → Database trigger
6. Edge Function (send-push-notification) invoked
7. Web Push delivered to browser
```

**Notification Preferences** (`notification_preferences` table):
- `in_app_enabled`: In-app通知のON/OFF
- `web_push_enabled`: Web Push通知のON/OFF
- `quiet_hours`: JSON (`{ start, end, timezone }`)
  - タイムゾーンを考慮したquiet hours判定
  - 日をまたぐ範囲にも対応（22:00 → 07:00）

**Delivery Logic** (`supabase/functions/send-push-notification/index.ts`):
1. Notification作成時にDatabase triggerでEdge Function起動
2. 受信者の`notification_preferences`を確認
3. Quiet hours判定（現在時刻 vs. 設定範囲）
4. レート制限チェック（per-subscription, per-minute）
5. Web Push送信（web-push library）
6. 配信履歴を`notification_delivery_logs`に記録
7. 連続失敗時は購読を削除

### E2E Testing

**Test Coverage** (`e2e/phase3-comments.spec.ts`, `e2e/phase3-webpush.spec.ts`):
- ✅ コメント CRUD 操作
- ✅ 返信機能
- ✅ `?card=` 経路でのモーダル表示
- ✅ リロード時の状態保持
- ✅ Realtime 同期（2ブラウザコンテキスト）
- ✅ Web Push permissions & 購読管理
- ✅ Notification preferences（quiet hours含む）

**Test Strategy**:
- 各テストで独立したボード作成
- `beforeEach` で setup、`afterEach` で cleanup
- Realtime テストは複数コンテキストで検証
- Web Push テストはService Worker起動確認

## Security Architecture

### Current Implementation

- **RLS enabled** on all tables
- **Public access** for MVP (allow all)
- **No authentication** required

### Future Auth Flow

```
1. User signs in (Supabase Auth)
2. JWT token in session
3. RLS policies check user_id
4. Only show user's own boards
```

Example policy:
```sql
CREATE POLICY "Users can only see their own lists"
  ON lists FOR SELECT
  USING (auth.uid() = user_id);
```

## Error Handling

### Strategy

```typescript
try {
  await supabase.from('cards').delete().eq('id', id);
} catch (error) {
  console.error('Error deleting card:', error);
  // UI already updated optimistically
  // Could show toast notification
}
```

- Optimistic UI: Don't wait for DB
- Log errors but don't block user
- Future: Retry failed syncs

## Testing Architecture

### E2E Tests (Playwright)

- Test all user flows
- Test mobile viewport
- Test persistence (reload)
- No mocking (real Supabase)

### Future Testing

- [ ] Unit tests (Jest + React Testing Library)
- [ ] Integration tests (API routes)
- [ ] Visual regression tests (Percy/Chromatic)

## Deployment Architecture

```
GitHub
  ↓ (push to main)
Vercel (CI/CD)
  ↓ (build)
Next.js Production Build
  ↓ (deploy)
Edge Network (Vercel Edge)
  ↓ (SSR/SSG)
Users worldwide
  ↓ (interact)
Supabase (Database)
```

- Auto-deploy on push to main
- Environment variables in Vercel
- Edge functions for fast SSR
- Global CDN for static assets
