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
│  │  • API Routes (Future: custom endpoints)         │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│                    Application Layer                      │
│  ┌─────────────────────┐    ┌─────────────────────────┐  │
│  │  React Components   │    │  Custom Hooks           │  │
│  │                     │    │                         │  │
│  │  • KanbanBoardClient │   │  • useSensor            │  │
│  │  • SortableList     │    │  • useSortable          │  │
│  │  • SortableCard     │    │  • useDndContext        │  │
│  └─────────────────────┘    └─────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│                      Business Logic                       │
│  ┌──────────────────────────────────────────────────┐    │
│  │           Event Handlers & State Management      │    │
│  │                                                  │    │
│  │  • handleAddList / handleAddCard                │    │
│  │  • handleEditList / handleEditCard              │    │
│  │  • handleDeleteList / handleDeleteCard          │    │
│  │  • handleDragStart / handleDragOver / End       │    │
│  │  • updateData (local state + cache + sync)      │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│                      Data Layer                           │
│  ┌─────────────────────┐    ┌──────────────────────┐     │
│  │   Local Storage     │    │    Supabase Client   │     │
│  │                     │    │                      │     │
│  │  • Cache            │    │  • PostgreSQL DB     │     │
│  │  • Offline support  │◄──►│  • REST API          │     │
│  │  • Fast reads       │    │  • Realtime (cards/lists) │ │
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
        ├── Header (board selector, filters, status)
        ├── DndContext (@dnd-kit)
        │   ├── SortableContext (lists)
        │   │   └── SortableList × N
        │   │       ├── List header & menu (rename/delete)
        │   │       ├── SortableContext (cards)
        │   │       │   └── SortableCard × M
        │   │       └── “+ Add Card” button
        │   └── “+ Add List” button
        ├── DragOverlay
        └── CardModal (selectedCardId が存在する場合)
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
  position: number;     // For ordering within list
  created_at: string;
  updated_at: string;
}
```

### State Updates

All state lives in `KanbanBoard` component:

```typescript
const [boards, setBoards] = useState<Board[]>(initialBoard ? [initialBoard] : []);
const [currentBoardId, setCurrentBoardId] = useState(initialBoard?.id ?? MAIN_BOARD_ID);
const [boardData, setBoardData] = useState<BoardData>(initialData ?? { lists: [], cards: [] });
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

### E2E Testing

**Test Coverage** (`e2e/phase3-comments.spec.ts`):
- ✅ コメント CRUD 操作
- ✅ 返信機能
- ✅ `?card=` 経路でのモーダル表示
- ✅ リロード時の状態保持
- ✅ Realtime 同期（2ブラウザコンテキスト）

**Test Strategy**:
- 各テストで独立したボード作成
- `beforeEach` で setup、`afterEach` で cleanup
- Realtime テストは複数コンテキストで検証

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
