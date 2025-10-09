# Component Structure

## Component Hierarchy

```
KanbanBoard (Root Component)
│
├── State Management
│   ├── boardData: { lists, cards }
│   ├── activeId: string | null
│   └── isClient: boolean
│
├── Event Handlers
│   ├── handleAddList()
│   ├── handleAddCard(listId)
│   ├── handleEditCard(id, title, desc)
│   ├── handleDeleteCard(id)
│   ├── handleEditList(id, title)
│   ├── handleDeleteList(id)
│   ├── handleDragStart(event)
│   ├── handleDragOver(event)
│   └── handleDragEnd(event)
│
└── Rendered Tree
    └── DndContext
        ├── SortableContext (horizontal)
        │   └── SortableList × N
        │       ├── List Header
        │       │   ├── Title (editable)
        │       │   └── Menu (⋯)
        │       │       ├── Rename
        │       │       └── Delete
        │       ├── SortableContext (vertical)
        │       │   └── SortableCard × N
        │       │       ├── Card Content
        │       │       │   ├── Title
        │       │       │   ├── Description
        │       │       │   └── Actions (Edit/Delete)
        │       │       └── Edit Mode
        │       │           ├── Title Input
        │       │           ├── Description Textarea
        │       │           └── Save/Cancel Buttons
        │       └── Add Card Button
        ├── Add List Button
        └── DragOverlay
```

## KanbanBoard Component

**Location**: `app/page.tsx`

### Responsibilities

- Main container and state owner
- Orchestrates all operations
- Manages data persistence
- Handles drag & drop events

### Props

None (root page component)

### State

```typescript
const [boardData, setBoardData] = useState<BoardData>({
  lists: [],
  cards: []
});
const [activeId, setActiveId] = useState<string | null>(null);
const [isClient, setIsClient] = useState(false);
```

### Key Functions

#### Data Loading

```typescript
useEffect(() => {
  setIsClient(true);
  const loadData = async () => {
    const data = await loadFromSupabase();
    if (data.lists.length === 0) {
      const defaultLists = await initializeDefaultLists();
      // ...
    }
    setBoardData(data);
    saveToStorage(data);
  };
  loadData();
}, []);
```

#### Data Persistence

```typescript
const updateData = (newData: BoardData) => {
  setBoardData(newData);        // Update UI
  saveToStorage(newData);        // Cache
};

const syncToSupabase = async (data: BoardData) => {
  await supabase.from('lists').upsert(data.lists);
  await supabase.from('cards').upsert(data.cards);
};
```

#### CRUD Operations

```typescript
// CREATE
const handleAddList = async () => {
  const newList = { id: uuidv4(), title: 'New List', ... };
  const newData = { ...boardData, lists: [...boardData.lists, newList] };
  updateData(newData);
  await syncToSupabase(newData);
};

// UPDATE
const handleEditCard = async (id, title, description) => {
  const updatedCards = boardData.cards.map(card =>
    card.id === id ? { ...card, title, description, updated_at: ... } : card
  );
  const newData = { ...boardData, cards: updatedCards };
  updateData(newData);
  await syncToSupabase(newData);
};

// DELETE
const handleDeleteCard = async (id) => {
  const updatedCards = boardData.cards.filter(card => card.id !== id);
  const newData = { ...boardData, cards: updatedCards };
  updateData(newData);
  await supabase.from('cards').delete().eq('id', id);
};
```

#### Drag & Drop

```typescript
const handleDragStart = (event) => {
  setActiveId(event.active.id);
};

const handleDragOver = (event) => {
  // Optimistic UI updates during drag
  // Move cards between lists visually
};

const handleDragEnd = async (event) => {
  setActiveId(null);
  // Calculate final positions
  // Save to database
  await syncToSupabase(newData);
};
```

### Render

```tsx
return (
  <div className="min-h-screen bg-gradient-to-br from-white via-slate-50/30 to-blue-50/50 p-4 md:p-8">
    <h1>Taesk Board</h1>
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={...} onDragOver={...} onDragEnd={...}>
      <div className="flex gap-3 md:gap-4 overflow-x-auto">
        <SortableContext items={sortedLists.map(l => l.id)} strategy={horizontalListSortingStrategy}>
          {sortedLists.map(list => (
            <SortableList key={list.id} list={list} cards={...} onAddCard={...} onEditCard={...} onDeleteCard={...} onEditList={...} onDeleteList={...} />
          ))}
        </SortableContext>
        <button onClick={handleAddList}>+ Add List</button>
      </div>
      <DragOverlay>{activeId ? <div>Dragging...</div> : null}</DragOverlay>
    </DndContext>
  </div>
);
```

## SortableList Component

**Location**: `app/page.tsx` (function component)

### Responsibilities

- Render a single list
- Manage list title editing
- Contain sortable cards
- Provide add card functionality

### Props

```typescript
interface SortableListProps {
  list: List;
  cards: Card[];
  onAddCard: (listId: string) => void;
  onEditCard: (id: string, title: string, description: string) => void;
  onDeleteCard: (id: string) => void;
  onEditList: (id: string, title: string) => void;
  onDeleteList: (id: string) => void;
}
```

### State

```typescript
const [isEditingTitle, setIsEditingTitle] = useState(false);
const [title, setTitle] = useState(list.title);
const [showMenu, setShowMenu] = useState(false);
```

### Hooks

```typescript
const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
  id: list.id,
  data: { type: 'list', list }
});
```

### Key Features

#### Title Editing

```tsx
{isEditingTitle ? (
  <input
    value={title}
    onChange={(e) => setTitle(e.target.value)}
    onBlur={handleSaveTitle}
    onKeyDown={(e) => {
      if (e.key === 'Enter') handleSaveTitle();
      if (e.key === 'Escape') {
        setTitle(list.title);
        setIsEditingTitle(false);
      }
    }}
  />
) : (
  <h2>{list.title}</h2>
)}
```

#### Menu (Rename/Delete)

```tsx
<button onClick={() => setShowMenu(!showMenu)}>⋯</button>
{showMenu && (
  <div className="menu">
    <button onClick={() => setIsEditingTitle(true)}>Rename</button>
    <button onClick={() => { if (confirm('Delete?')) onDeleteList(list.id); }}>Delete</button>
  </div>
)}
```

#### Card Container

```tsx
<SortableContext items={sortedCards.map(c => c.id)} strategy={verticalListSortingStrategy}>
  {sortedCards.map(card => (
    <SortableCard key={card.id} card={card} onEdit={onEditCard} onDelete={onDeleteCard} />
  ))}
</SortableContext>
<button onClick={() => onAddCard(list.id)}>+ Add Card</button>
```

### Render

```tsx
return (
  <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="bg-white/70 rounded-2xl p-4 w-72 md:w-80">
    {/* Header */}
    {/* Cards */}
    {/* Add Card Button */}
  </div>
);
```

## SortableCard Component

**Location**: `app/page.tsx` (function component)

### Responsibilities

- Render a single card
- Handle card editing (inline)
- Provide delete functionality
- Enable dragging

### Props

```typescript
interface SortableCardProps {
  card: Card;
  onEdit: (id: string, title: string, description: string) => void;
  onDelete: (id: string) => void;
}
```

### State

```typescript
const [isEditing, setIsEditing] = useState(false);
const [title, setTitle] = useState(card.title);
const [description, setDescription] = useState(card.description);
```

### Hooks

```typescript
const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
  id: card.id,
  data: { type: 'card', card }
});
```

### Key Features

#### View Mode

```tsx
<div>
  <h3>{card.title}</h3>
  {card.description && <p>{card.description}</p>}
  <button onClick={() => setIsEditing(true)}>Edit</button>
  <button onClick={() => onDelete(card.id)}>Delete</button>
</div>
```

#### Edit Mode

```tsx
<div>
  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Card title" />
  <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
  <button onClick={handleSave}>Save</button>
  <button onClick={handleCancel}>Cancel</button>
</div>
```

#### Save/Cancel

```typescript
const handleSave = () => {
  onEdit(card.id, title, description);
  setIsEditing(false);
};

const handleCancel = () => {
  setTitle(card.title);
  setDescription(card.description);
  setIsEditing(false);
};
```

### Render

```tsx
return (
  <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="bg-white rounded-xl p-4 mb-3 cursor-grab">
    {isEditing ? <EditMode /> : <ViewMode />}
  </div>
);
```

## Shared Utilities

### loadFromSupabase

```typescript
const loadFromSupabase = async (): Promise<BoardData> => {
  try {
    const [{ data: lists }, { data: cards }] = await Promise.all([
      supabase.from('lists').select('*').order('position'),
      supabase.from('cards').select('*').order('position'),
    ]);
    return { lists: lists || [], cards: cards || [] };
  } catch (error) {
    console.error('Error loading from Supabase:', error);
    return loadFromStorage();  // Fallback
  }
};
```

### saveToStorage / loadFromStorage

```typescript
const STORAGE_KEY = 'kanban_board_data';

const saveToStorage = (data: BoardData) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

const loadFromStorage = (): BoardData => {
  if (typeof window === 'undefined') return { lists: [], cards: [] };
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : { lists: [], cards: [] };
};
```

### initializeDefaultLists

```typescript
const initializeDefaultLists = async (): Promise<List[]> => {
  const defaultLists = [
    { title: 'To Do', position: 0 },
    { title: 'In Progress', position: 1 },
    { title: 'Done', position: 2 },
  ];
  const { data } = await supabase.from('lists').insert(defaultLists).select();
  return data || [];
};
```

## Styling Conventions

### Tailwind Classes

- **Responsive**: `w-72 md:w-80`, `p-4 md:p-8`
- **Colors**: `bg-white/70`, `text-slate-700`, `border-slate-200`
- **Interactive**: `hover:bg-sky-500`, `cursor-grab active:cursor-grabbing`
- **Mobile**: `touch-none` (prevent scroll while dragging)

### Dark Mode

```tsx
className="bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-100"
```

Uses system preference (`prefers-color-scheme`).

## Component Best Practices

### 1. Single Responsibility

Each component has one job:
- `KanbanBoard`: State & orchestration
- `SortableList`: List rendering & editing
- `SortableCard`: Card rendering & editing

### 2. Props Down, Events Up

- Parent passes data down via props
- Children notify parent via callbacks
- No prop drilling (only 2 levels deep)

### 3. Controlled Components

All inputs are controlled:
```tsx
<input value={title} onChange={(e) => setTitle(e.target.value)} />
```

### 4. Optimistic UI

Update UI immediately, sync async:
```typescript
updateData(newData);           // UI updates now
await syncToSupabase(newData); // Background
```

### 5. Error Boundaries

Future improvement:
```tsx
<ErrorBoundary fallback={<ErrorUI />}>
  <KanbanBoard />
</ErrorBoundary>
```

## Performance Optimizations

### Current

- Lazy state initialization: `useState(() => loadFromStorage())`
- Stable keys: Use UUIDs, not array indexes
- Sorted only when needed: `const sortedLists = [...boardData.lists].sort(...)`

### Future

```typescript
const MemoizedCard = React.memo(SortableCard, (prev, next) =>
  prev.card.id === next.card.id &&
  prev.card.title === next.card.title &&
  prev.card.description === next.card.description
);
```

## Accessibility

### Current

- Semantic HTML: `<button>`, `<input>`, `<h1>`, `<h2>`
- Keyboard support: dnd-kit handles keyboard drag
- Focus management: `autoFocus` on inputs

### Future Improvements

- [ ] ARIA labels for screen readers
- [ ] Focus trap in edit mode
- [ ] Keyboard shortcuts (Ctrl+N for new card)
- [ ] Announce drag actions to screen readers

## Testing Strategy

### E2E Tests

Test user flows:
```typescript
test('should add a card', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add Card' }).first().click();
  await expect(page.getByText('New Card')).toBeVisible();
});
```

### Future Unit Tests

```typescript
describe('handleEditCard', () => {
  it('should update card title and description', () => {
    const { result } = renderHook(() => useKanbanBoard());
    act(() => {
      result.current.handleEditCard('id-1', 'New Title', 'New Desc');
    });
    expect(result.current.boardData.cards[0].title).toBe('New Title');
  });
});
```

## Component Diagram

```
┌─────────────────────────────────────────────────────┐
│                   KanbanBoard                       │
│  ┌───────────────────────────────────────────────┐  │
│  │ State: boardData, activeId, isClient         │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │ Handlers: handleAdd*, handleEdit*,           │  │
│  │           handleDelete*, handleDrag*         │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │ Render:                                      │  │
│  │   <DndContext>                               │  │
│  │     <SortableList /> × N                     │  │
│  │     <AddListButton />                        │  │
│  │   </DndContext>                              │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
┌──────────────────┐           ┌──────────────────┐
│  SortableList    │           │  SortableList    │
│  ┌────────────┐  │           │  ┌────────────┐  │
│  │ State:     │  │           │  │ State:     │  │
│  │ isEditing  │  │           │  │ isEditing  │  │
│  │ title      │  │           │  │ title      │  │
│  │ showMenu   │  │           │  │ showMenu   │  │
│  └────────────┘  │           │  └────────────┘  │
│  ┌────────────┐  │           │  ┌────────────┐  │
│  │ Render:    │  │           │  │ Render:    │  │
│  │ Header     │  │           │  │ Header     │  │
│  │ Cards      │  │           │  │ Cards      │  │
│  │ AddCard    │  │           │  │ AddCard    │  │
│  └────────────┘  │           │  └────────────┘  │
└────────┬─────────┘           └────────┬─────────┘
         │                              │
    ┌────┴────┐                    ┌────┴────┐
    ▼         ▼                    ▼         ▼
┌────────┐ ┌────────┐          ┌────────┐ ┌────────┐
│ Card 1 │ │ Card 2 │          │ Card 3 │ │ Card 4 │
└────────┘ └────────┘          └────────┘ └────────┘
```
