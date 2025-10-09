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
│  │  • KanbanBoard      │    │  • useSensor            │  │
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
│  │  • Fast reads       │    │  • Real-time (TBD)   │     │
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
App (layout.tsx)
└── KanbanBoard (page.tsx)
    ├── DndContext (from @dnd-kit)
    │   ├── SortableContext (horizontal, for lists)
    │   │   └── SortableList (× N lists)
    │   │       ├── useSortable hook
    │   │       ├── List Header (with edit/delete menu)
    │   │       ├── SortableContext (vertical, for cards)
    │   │       │   └── SortableCard (× N cards)
    │   │       │       ├── useSortable hook
    │   │       │       └── Card content (edit/delete buttons)
    │   │       └── Add Card Button
    │   └── Add List Button
    └── DragOverlay (visual feedback while dragging)
```

### Data Flow

```
                    ┌──────────────┐
                    │ KanbanBoard  │
                    │  Component   │
                    │              │
                    │ State:       │
                    │ • boardData  │
                    │ • activeId   │
                    └───────┬──────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
    ┌───────────┐   ┌──────────┐   ┌──────────┐
    │ List 1    │   │ List 2   │   │ List 3   │
    ├───────────┤   ├──────────┤   ├──────────┤
    │ Card A    │   │ Card C   │   │ Card E   │
    │ Card B    │   │ Card D   │   │          │
    └───────────┘   └──────────┘   └──────────┘
           │               │               │
           └───────────────┴───────────────┘
                           │
                           ▼
                    User Actions
                  (onClick, onDrag)
                           │
                           ▼
                 Event Handlers in Parent
              (handleAddCard, handleDragEnd)
                           │
                           ▼
                    updateData()
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       localStorage               Supabase
```

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
const [boardData, setBoardData] = useState<BoardData>({
  lists: [],
  cards: []
});
const [activeId, setActiveId] = useState<string | null>(null);
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
    delay: 200,        // Long-press to drag
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
- [ ] Real-time subscriptions (Supabase Realtime)

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
