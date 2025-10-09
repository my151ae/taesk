# Storage Strategy

## Hybrid Storage Architecture

Taesk uses a **hybrid storage approach** combining Supabase (cloud) and localStorage (client cache).

### Storage Layers

```
┌─────────────────────────────────────┐
│     React State (In-Memory)         │  ← Active UI state
│     • boardData: { lists, cards }   │
│     • Fastest access                │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│     localStorage (Browser)          │  ← Client-side cache
│     • Persistent across reloads     │
│     • Offline support                │
│     • 5-10MB storage limit           │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│     Supabase (Cloud PostgreSQL)     │  ← Source of truth
│     • Multi-device sync              │
│     • Unlimited storage              │
│     • ACID guarantees                │
└─────────────────────────────────────┘
```

## Data Flow

### Read Flow (Initial Load)

```
1. User opens app
   ↓
2. Try load from Supabase
   ├─ SUCCESS → Cache to localStorage → Render
   └─ FAIL → Load from localStorage → Render (offline mode)
```

### Write Flow (User Action)

```
1. User performs action (add/edit/delete)
   ↓
2. Update React state → Instant UI feedback
   ↓
3. Save to localStorage → Persistent on reload
   ↓
4. Sync to Supabase (async) → Multi-device sync
   ├─ SUCCESS → Done
   └─ FAIL → Log error, data still in localStorage
```

## Implementation Details

### localStorage

**Key**: `"kanban_board_data"`

**Structure**:
```json
{
  "lists": [
    {
      "id": "uuid-1",
      "title": "To Do",
      "position": 0,
      "created_at": "2025-01-01T00:00:00Z",
      "updated_at": "2025-01-01T00:00:00Z"
    }
  ],
  "cards": [
    {
      "id": "uuid-2",
      "title": "Card 1",
      "description": "Details",
      "list_id": "uuid-1",
      "position": 0,
      "created_at": "2025-01-01T00:00:00Z",
      "updated_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

**Code**:
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

### Supabase

**Tables**: `lists`, `cards`

**Operations**:
```typescript
// READ
const loadFromSupabase = async (): Promise<BoardData> => {
  const [{ data: lists }, { data: cards }] = await Promise.all([
    supabase.from('lists').select('*').order('position'),
    supabase.from('cards').select('*').order('position'),
  ]);
  return { lists: lists || [], cards: cards || [] };
};

// WRITE (Upsert)
const syncToSupabase = async (data: BoardData) => {
  await Promise.all([
    supabase.from('lists').upsert(data.lists),
    supabase.from('cards').upsert(data.cards),
  ]);
};

// DELETE
await supabase.from('cards').delete().eq('id', cardId);
await supabase.from('lists').delete().eq('id', listId);
```

## Synchronization Strategy

### Write-Through Cache Pattern

Every write updates **all three layers**:

```typescript
const updateData = (newData: BoardData) => {
  // Layer 1: React state (sync)
  setBoardData(newData);

  // Layer 2: localStorage (sync)
  saveToStorage(newData);

  // Layer 3: Supabase (async) - called by handler
};

const handleAddCard = async (listId: string) => {
  const newCard = { id: uuidv4(), ... };
  const newData = { ...boardData, cards: [...boardData.cards, newCard] };

  updateData(newData);           // Layers 1 & 2
  await syncToSupabase(newData); // Layer 3
};
```

### Conflict Resolution

**Current**: Last-write-wins (no conflict detection)

**Future**: Implement optimistic locking or CRDT

```typescript
// Optimistic locking example
interface Card {
  // ... existing fields
  version: number; // Increment on each update
}

const handleEditCard = async (id, title, description) => {
  const card = boardData.cards.find(c => c.id === id);
  const updatedCard = {
    ...card,
    title,
    description,
    version: card.version + 1,
    updated_at: new Date().toISOString()
  };

  // Update optimistically
  updateData(newData);

  // Sync with version check
  const { error } = await supabase
    .from('cards')
    .update(updatedCard)
    .eq('id', id)
    .eq('version', card.version); // Fail if version mismatch

  if (error) {
    // Conflict: reload from server
    const freshData = await loadFromSupabase();
    updateData(freshData);
    alert('Card was updated by another device. Please try again.');
  }
};
```

## Offline Support

### Current Implementation

- ✅ App works offline (reads from localStorage)
- ✅ Writes to localStorage succeed
- ❌ No sync queue for offline writes

### Future Improvement: Sync Queue

```typescript
interface PendingSync {
  id: string;
  operation: 'create' | 'update' | 'delete';
  table: 'lists' | 'cards';
  data: any;
  timestamp: string;
}

const syncQueue: PendingSync[] = [];

const queueSync = (operation: PendingSync) => {
  syncQueue.push(operation);
  localStorage.setItem('sync_queue', JSON.stringify(syncQueue));
};

const processSyncQueue = async () => {
  while (syncQueue.length > 0 && navigator.onLine) {
    const operation = syncQueue[0];
    try {
      await executeSyncOperation(operation);
      syncQueue.shift(); // Remove on success
    } catch (error) {
      break; // Stop on first failure
    }
  }
  localStorage.setItem('sync_queue', JSON.stringify(syncQueue));
};

// Listen for online event
window.addEventListener('online', processSyncQueue);
```

## Data Consistency

### Guarantees

1. **React state ↔ localStorage**: Always in sync (synchronous)
2. **localStorage ↔ Supabase**: Eventually consistent (async)
3. **Supabase**: ACID guarantees (PostgreSQL)

### Edge Cases

#### Case 1: Supabase sync fails

```
User adds card
  → UI updates ✅
  → localStorage saves ✅
  → Supabase fails ❌

Result: Card visible in app, but not synced to other devices
Solution: Retry on next page load or implement sync queue
```

#### Case 2: Page reload before sync

```
User adds card → closes tab immediately
  → UI updated ✅
  → localStorage saved ✅
  → Supabase sync incomplete ❌

Result: Card persists in localStorage, missing from Supabase
Solution: Sync on app init, compare local vs remote timestamps
```

#### Case 3: Concurrent edits from multiple devices

```
Device A: Edit card title → "New Title A"
Device B: Edit card description → "New Desc B"

Without conflict resolution:
  → Last write wins (data loss)

With conflict resolution:
  → Merge non-conflicting fields
  → Prompt user for conflicting fields
```

## Performance Considerations

### localStorage Limits

- **Size**: ~5-10MB (browser-dependent)
- **Estimate**: 1000 cards × 1KB each = 1MB ✅
- **Max**: ~5000 cards before issues

### Optimization Strategies

1. **Lazy loading**: Only load visible lists initially
2. **Pagination**: Load cards in chunks
3. **Compression**: gzip localStorage data
4. **Indexing**: Use Map<id, item> for O(1) lookups

```typescript
// Optimized data structure for large datasets
interface OptimizedBoardData {
  lists: Map<string, List>;
  cards: Map<string, Card>;
  listOrder: string[];
  cardsByList: Map<string, string[]>;
}
```

## Monitoring & Debugging

### localStorage Inspector

```typescript
// Development helper
const inspectStorage = () => {
  const data = localStorage.getItem('kanban_board_data');
  console.log('localStorage size:', new Blob([data]).size, 'bytes');
  console.log('Data:', JSON.parse(data));
};
```

### Supabase Logs

```typescript
// Via MCP
const logs = await mcp.supabase.get_logs({ service: 'api' });
console.log('Recent DB operations:', logs);
```

### Sync Status Indicator

Future feature:
```tsx
const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline'>('synced');

<div className="status-bar">
  {syncStatus === 'syncing' && '⏳ Syncing...'}
  {syncStatus === 'offline' && '📴 Offline'}
  {syncStatus === 'synced' && '✅ Synced'}
</div>
```

## Best Practices

1. **Always update all layers**: State → localStorage → Supabase
2. **Handle failures gracefully**: Log errors, don't crash
3. **Validate before save**: Check data integrity
4. **Use transactions for multi-step operations**
5. **Implement retry logic for network errors**
6. **Clear stale data**: Implement TTL for localStorage

## Security

### localStorage

- ⚠️ **Not encrypted** (accessible via DevTools)
- ✅ **Same-origin policy** (isolated per domain)
- ❌ **No sensitive data** (public board data only)

### Supabase

- ✅ **SSL/TLS encryption** in transit
- ✅ **RLS policies** (future: user-specific)
- ✅ **API keys** (environment variables)
- ✅ **Database encryption** at rest

### Future: Encryption

For sensitive data:
```typescript
import CryptoJS from 'crypto-js';

const encrypt = (data: string, key: string) =>
  CryptoJS.AES.encrypt(data, key).toString();

const decrypt = (encrypted: string, key: string) =>
  CryptoJS.AES.decrypt(encrypted, key).toString(CryptoJS.enc.Utf8);

const saveToStorage = (data: BoardData, userKey: string) => {
  const encrypted = encrypt(JSON.stringify(data), userKey);
  localStorage.setItem(STORAGE_KEY, encrypted);
};
```

## Migration Strategy

### Adding New Storage Layer (e.g., IndexedDB)

```typescript
// 1. Create adapter interface
interface StorageAdapter {
  save(data: BoardData): Promise<void>;
  load(): Promise<BoardData>;
}

// 2. Implement adapters
class LocalStorageAdapter implements StorageAdapter { ... }
class IndexedDBAdapter implements StorageAdapter { ... }
class SupabaseAdapter implements StorageAdapter { ... }

// 3. Use adapters
const adapters = [
  new IndexedDBAdapter(),
  new SupabaseAdapter(),
];

const saveToAll = async (data: BoardData) => {
  await Promise.all(adapters.map(a => a.save(data)));
};
```
