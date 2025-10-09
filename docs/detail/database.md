# Database Schema

## Overview

Taesk uses **PostgreSQL** via **Supabase** with a simple relational schema optimized for a Kanban board.

## Schema Diagram

```
┌──────────────────────────────────────┐
│             lists                    │
├──────────────────────────────────────┤
│ id          UUID PRIMARY KEY         │
│ title       TEXT NOT NULL            │
│ position    INTEGER NOT NULL         │
│ created_at  TIMESTAMPTZ NOT NULL     │
│ updated_at  TIMESTAMPTZ NOT NULL     │
└──────────────────┬───────────────────┘
                   │
                   │ 1
                   │
                   │
                   │ N
                   ▼
┌──────────────────────────────────────┐
│             cards                    │
├──────────────────────────────────────┤
│ id          UUID PRIMARY KEY         │
│ title       TEXT NOT NULL            │
│ description TEXT                     │
│ list_id     UUID NOT NULL FK         │────┐
│ position    INTEGER NOT NULL         │    │
│ created_at  TIMESTAMPTZ NOT NULL     │    │
│ updated_at  TIMESTAMPTZ NOT NULL     │    │
└──────────────────────────────────────┘    │
                                            │
                                            │
         FOREIGN KEY (list_id)              │
         REFERENCES lists(id)               │
         ON DELETE CASCADE ─────────────────┘
```

## Table: `lists`

### Schema

```sql
CREATE TABLE public.lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
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
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last update timestamp |

### Indexes

```sql
CREATE INDEX lists_position_idx ON public.lists(position);
```

**Why**: Optimize ordering queries.

### Example Data

```json
{
  "id": "dc8fb019-6381-4264-8218-487db90fce48",
  "title": "To Do",
  "position": 0,
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
| `position` | INTEGER | NOT NULL | Order within list (0, 1, 2...) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last update timestamp |

### Indexes

```sql
CREATE INDEX cards_list_id_idx ON public.cards(list_id);
CREATE INDEX cards_position_idx ON public.cards(position);
```

**Why**:
- `cards_list_id_idx`: Fast lookup of cards in a list
- `cards_position_idx`: Optimize ordering queries

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
  "description": "Add Supabase Auth with email/password",
  "list_id": "dc8fb019-6381-4264-8218-487db90fce48",
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

### Current Policies

```sql
-- Enable RLS
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

-- Allow all operations (MVP)
CREATE POLICY "Allow all operations on lists"
  ON public.lists FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on cards"
  ON public.cards FOR ALL
  USING (true)
  WITH CHECK (true);
```

### Future Auth Policies

When adding authentication:

```sql
-- Users table
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add user_id to lists
ALTER TABLE public.lists ADD COLUMN user_id UUID REFERENCES public.users(id);

-- Update policy
DROP POLICY "Allow all operations on lists" ON public.lists;

CREATE POLICY "Users can only see their own lists"
  ON public.lists FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can only modify their own lists"
  ON public.lists FOR UPDATE
  USING (auth.uid() = user_id);

-- Similar for cards (inherit from list's user_id)
```

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
  created_at: string;
  updated_at: string;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  list_id: string;
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
