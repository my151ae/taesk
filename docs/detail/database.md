# Database Schema

## Overview

Taesk uses **PostgreSQL** via **Supabase** with a simple relational schema optimized for a Kanban board.

## Schema Diagram

```
                   ┌──────────────────────────┐
                   │      auth.users         │
                   │   (Supabase Auth)       │
                   └───────────┬─────────────┘
                               │
                               │ 1
                               │
                               │
                               │ N
                               ▼
┌──────────────────────────────────────┐
│             lists                    │
├──────────────────────────────────────┤
│ id          UUID PRIMARY KEY         │
│ title       TEXT NOT NULL            │
│ position    INTEGER NOT NULL         │
│ user_id     UUID NOT NULL FK         │────┐
│ created_at  TIMESTAMPTZ NOT NULL     │    │
│ updated_at  TIMESTAMPTZ NOT NULL     │    │
└──────────────────┬───────────────────┘    │
                   │                         │
                   │ 1                       │
                   │                         │
                   │                  FOREIGN KEY (user_id)
                   │ N                REFERENCES auth.users(id)
                   ▼                         │
┌──────────────────────────────────────┐    │
│             cards                    │    │
├──────────────────────────────────────┤    │
│ id          UUID PRIMARY KEY         │    │
│ title       TEXT NOT NULL            │    │
│ description TEXT                     │    │
│ list_id     UUID NOT NULL FK         │────┼──┐
│ user_id     UUID NOT NULL FK         │────┘  │
│ position    INTEGER NOT NULL         │       │
│ created_at  TIMESTAMPTZ NOT NULL     │       │
│ updated_at  TIMESTAMPTZ NOT NULL     │       │
└──────────────────────────────────────┘       │
                                               │
                                               │
         FOREIGN KEY (list_id)                 │
         REFERENCES lists(id)                  │
         ON DELETE CASCADE ────────────────────┘
```

## Table: `lists`

### Schema

```sql
CREATE TABLE public.lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Fields

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique identifier |
| `title` | TEXT | NOT NULL | Display name of the list |
| `position` | INTEGER | NOT NULL | Order of lists (0, 1, 2...) |
| `user_id` | UUID | NOT NULL, FK → auth.users(id) | Owner of the list |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last update timestamp |

### Indexes

```sql
CREATE INDEX lists_position_idx ON public.lists(position);
CREATE INDEX idx_lists_user_id ON public.lists(user_id);
```

**Why**:
- `position`: Optimize ordering queries
- `user_id`: Optimize user-specific queries and RLS policies

### Example Data

```json
{
  "id": "dc8fb019-6381-4264-8218-487db90fce48",
  "title": "To Do",
  "position": 0,
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "created_at": "2025-10-09T02:00:16.272332+00:00",
  "updated_at": "2025-10-09T02:00:16.272332+00:00"
}
```

## Table: `cards`

### Schema

```sql
CREATE TABLE public.cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  list_id UUID NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Fields

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique identifier |
| `title` | TEXT | NOT NULL | Card title (summary) |
| `description` | TEXT | NULLABLE | Card description (details) |
| `list_id` | UUID | NOT NULL, FK → lists(id) | Parent list |
| `user_id` | UUID | NOT NULL, FK → auth.users(id) | Owner of the card |
| `position` | INTEGER | NOT NULL | Order within list (0, 1, 2...) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last update timestamp |

### Indexes

```sql
CREATE INDEX cards_list_id_idx ON public.cards(list_id);
CREATE INDEX cards_position_idx ON public.cards(position);
CREATE INDEX idx_cards_user_id ON public.cards(user_id);
```

**Why**:
- `list_id`: Fast lookup of cards in a list
- `position`: Optimize ordering queries
- `user_id`: Optimize user-specific queries and RLS policies

### Cascade Behavior

```sql
ON DELETE CASCADE
```

When a list is deleted, all its cards are automatically deleted.

### Example Data

```json
{
  "id": "893c9c25-2b4c-4f98-8845-fb33647b8325",
  "title": "Implement user authentication",
  "description": "Add Supabase Auth with Google OAuth",
  "list_id": "dc8fb019-6381-4264-8218-487db90fce48",
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "position": 0,
  "created_at": "2025-10-09T02:00:22.635000+00:00",
  "updated_at": "2025-10-09T02:00:22.638000+00:00"
}
```

## Relationships

### One-to-Many: List → Cards

- **One list** can have **many cards**
- **Each card** belongs to **one list**
- Foreign key: `cards.list_id → lists.id`

### Cascade Delete

```
DELETE FROM lists WHERE id = 'xxx';
  ↓ (CASCADE)
DELETE FROM cards WHERE list_id = 'xxx';
```

## Row Level Security (RLS)

### Current Policies (✅ Implemented)

RLS is enabled and allows all authenticated users to access all data (shared team board):

```sql
-- Enable RLS
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

-- Lists policies: all authenticated users can access all lists
CREATE POLICY "Authenticated users can view all lists"
  ON lists FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert lists"
  ON lists FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update all lists"
  ON lists FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete all lists"
  ON lists FOR DELETE
  TO authenticated
  USING (true);

-- Cards policies: all authenticated users can access all cards
CREATE POLICY "Authenticated users can view all cards"
  ON cards FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert cards"
  ON cards FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update all cards"
  ON cards FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete all cards"
  ON cards FOR DELETE
  TO authenticated
  USING (true);
```

### Security Guarantees

✅ **Authenticated users can**:
- View all lists and cards (shared team board)
- Create, update, and delete any lists/cards
- Collaborate with other team members in real-time

❌ **Unauthenticated users CANNOT**:
- Access any data without logging in
- Bypass authentication (enforced at database level)

### Design Notes

**Current**: Shared team board - all authenticated users see the same data
**Future**: The `user_id` column is already in place for personal board features

### Testing RLS

```sql
-- Test as authenticated user
SELECT * FROM lists;  -- Shows all lists (shared board)
SELECT * FROM cards;  -- Shows all cards (shared board)

-- Test as unauthenticated (will fail)
-- RLS blocks all access
```

### Migrations

- ✅ `add_user_id_and_rls_policies`: Added user_id column and initial RLS policies
- ✅ `remove_old_permissive_policies`: Removed overly permissive policies
- ✅ `allow_all_authenticated_users_access`: Updated to shared team board model

## Triggers

### Auto-update `updated_at`

```sql
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER handle_lists_updated_at
  BEFORE UPDATE ON public.lists
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER handle_cards_updated_at
  BEFORE UPDATE ON public.cards
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
```

**Why**: Automatically track when records are modified.

## Migrations

### Migration File

Located in Supabase migrations:

```sql
-- supabase/migrations/YYYYMMDDHHMMSS_create_lists_and_cards_tables.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create lists table
CREATE TABLE public.lists (...);

-- Create cards table
CREATE TABLE public.cards (...);

-- Create indexes
CREATE INDEX ...;

-- Enable RLS
ALTER TABLE ...;

-- Create policies
CREATE POLICY ...;

-- Create triggers
CREATE TRIGGER ...;
```

### Running Migrations

Via Supabase MCP:
```typescript
await mcp.supabase.apply_migration({
  name: 'create_lists_and_cards_tables',
  query: `...`
});
```

Or via Supabase CLI:
```bash
supabase migration new create_lists_and_cards_tables
supabase db push
```

## Queries

### Fetch All Data

```typescript
// Lists
const { data: lists } = await supabase
  .from('lists')
  .select('*')
  .order('position', { ascending: true });

// Cards
const { data: cards } = await supabase
  .from('cards')
  .select('*')
  .order('position', { ascending: true });
```

### Create (Insert)

```typescript
const { data, error } = await supabase
  .from('lists')
  .insert([
    { title: 'To Do', position: 0 },
    { title: 'In Progress', position: 1 },
    { title: 'Done', position: 2 },
  ])
  .select();
```

### Update (Upsert)

```typescript
// Upsert = Insert or Update based on primary key
await supabase.from('lists').upsert(data.lists);
await supabase.from('cards').upsert(data.cards);
```

**Why upsert**: Idempotent, works for both create and update.

### Delete

```typescript
await supabase.from('cards').delete().eq('id', cardId);
await supabase.from('lists').delete().eq('id', listId);
// Cards cascade-deleted automatically
```

## Data Types (TypeScript)

```typescript
export interface List {
  id: string;
  title: string;
  position: number;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  list_id: string;
  user_id: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface BoardData {
  lists: List[];
  cards: Card[];
}
```

## Performance Considerations

### Indexing Strategy

- **Primary keys** (UUIDs): Automatic B-tree index
- **Foreign keys** (`list_id`): Indexed for JOIN performance
- **Position columns**: Indexed for ORDER BY

### Query Optimization

- **Batch reads**: Fetch all lists + cards in parallel
- **Upsert**: Single operation for create or update
- **Cascade delete**: Database handles cleanup

### Scaling

Current schema handles:
- ✅ Thousands of lists
- ✅ Hundreds of cards per list
- ✅ Fast queries with indexes

For millions of cards:
- Consider partitioning by user_id
- Add pagination
- Use Supabase Realtime for live updates

## Backup & Recovery

### Supabase Automatic Backups

- Daily backups (retained 7 days on free tier)
- Point-in-time recovery (paid plans)

### Manual Export

```bash
# Via Supabase CLI
supabase db dump -f backup.sql

# Via pg_dump
pg_dump -h db.xxx.supabase.co -U postgres -d postgres > backup.sql
```

## Monitoring

### Supabase Dashboard

- Query performance
- Table sizes
- Index usage
- Slow queries

### Logs

```typescript
// Via MCP
await mcp.supabase.get_logs({ service: 'api' });
```

## Future Schema Changes

### Planned Additions

1. **Users table** (for authentication)
2. **Boards table** (for multiple boards per user)
3. **Card metadata** (tags, due dates, assignees)
4. **Activity log** (audit trail)

### Migration Strategy

- Always use migrations (never manual SQL)
- Test in development branch first
- Use transactions for multi-step changes
- Keep migrations reversible when possible
