# Claude Code Workflow Rules for Taesk

## Project Overview

**Taesk** is a modern, mobile-first PWA Kanban board application built with Next.js 15, React 18, Supabase, and dnd-kit.

### Tech Stack
- **Frontend**: Next.js 15 (App Router), React 18, TypeScript
- **Styling**: Tailwind CSS 3
- **Drag & Drop**: @dnd-kit/core + @dnd-kit/sortable
- **Database**: Supabase (PostgreSQL)
- **Storage**: Hybrid (Supabase + localStorage)
- **Testing**: Playwright (E2E)
- **Deployment**: Vercel

### Key Features
- ✅ Drag & drop cards and lists
- ✅ Inline editing of cards and lists
- ✅ Hybrid storage (offline-first)
- ✅ Mobile-responsive with PWA support
- ✅ Auto-save to Supabase
- ✅ E2E test coverage

## Documentation

📚 **Complete documentation available in `/docs`**:
- [`/docs/index.md`](./docs/index.md) - Quick start and overview
- [`/docs/detail/architecture.md`](./docs/detail/architecture.md) - System architecture
- [`/docs/detail/database.md`](./docs/detail/database.md) - Database schema
- [`/docs/detail/components.md`](./docs/detail/components.md) - Component structure
- [`/docs/detail/storage.md`](./docs/detail/storage.md) - Storage strategy
- [`/docs/detail/deployment.md`](./docs/detail/deployment.md) - Deployment guide

📋 **Project Management**:
- [`/docs/tickets/README.md`](./docs/tickets/README.md) - タスク管理システムのルール
- [`/docs/tickets/YYYY-MM-DD/roadmap.md`](./docs/tickets/2025-10-09/roadmap.md) - 機能追加ロードマップ

**Always refer to these docs when working on Taesk to understand the full context.**

## Development Workflow

### Before Starting Work

1. **Read relevant documentation** from `/docs` to understand the system
2. **Check existing code** in `app/page.tsx` (main component)
3. **Review database schema** in Supabase or docs

### During Development

1. **Make code changes**
2. **Verify dev server is running** (`npm run dev`)
3. **Test in browser** with DevTools (use chrome-devtools MCP)
4. **Check for errors/warnings** in console
5. **Fix any issues** before proceeding
6. **Run E2E tests** if relevant (`npm run test:e2e`)

### Before Completing Work

#### 必須チェック項目 (Required Checks)

1. **コンソールエラー（赤）**: エラーがないか確認
2. **コンソール警告（黄）**: 警告がないか確認
3. **ネットワークエラー**: リクエストが正常に完了しているか確認
4. **ページ表示**: 意図した通りに表示されているか確認

#### ブラウザ確認手順

```typescript
// Use chrome-devtools MCP to verify:
1. Take snapshot → Check page renders correctly
2. List console messages → Verify no errors
3. List network requests → Verify all succeed (200/201)
4. Check Supabase data → Verify data persisted correctly
```

### Committing Changes

**DO NOT automatically push to main** unless user confirms the fix is working.

Workflow:
1. Make changes
2. Test locally with browser DevTools
3. **Wait for user confirmation** that it's working
4. Then commit and push

## Architecture Overview

### Component Structure

```
KanbanBoard (app/page.tsx)
├── State: boardData, activeId
├── Handlers: handleAdd*, handleEdit*, handleDelete*, handleDrag*
└── Render
    └── DndContext
        ├── SortableList × N
        │   └── SortableCard × N
        └── Add List Button
```

### Data Flow

```
User Action
  ↓
Update React State (instant UI)
  ↓
Save to localStorage (cache)
  ↓
Sync to Supabase (async, background)
```

### Storage Layers

1. **React State**: In-memory, for UI
2. **localStorage**: Client cache, offline support
3. **Supabase**: Cloud persistence, multi-device sync

## Database Schema

### Tables

**lists**:
- `id` (UUID, PK)
- `title` (TEXT)
- `position` (INTEGER)
- `created_at`, `updated_at` (TIMESTAMPTZ)

**cards**:
- `id` (UUID, PK)
- `title` (TEXT)
- `description` (TEXT, nullable)
- `list_id` (UUID, FK → lists.id)
- `position` (INTEGER)
- `created_at`, `updated_at` (TIMESTAMPTZ)

### Relationships

- One list → Many cards
- ON DELETE CASCADE (deleting list deletes its cards)

## Key Implementation Details

### CRUD Operations

All operations follow this pattern:
```typescript
const handleOperation = async () => {
  // 1. Update local data
  const newData = { ...boardData, /* changes */ };

  // 2. Update state + localStorage
  updateData(newData);

  // 3. Sync to Supabase
  await syncToSupabase(newData);
};
```

### Drag & Drop

Uses `@dnd-kit`:
- `handleDragStart`: Set activeId
- `handleDragOver`: Optimistic UI updates
- `handleDragEnd`: Save final positions to DB

### Mobile Optimizations

- Touch sensors with activation delay (200ms)
- Responsive widths: `w-72 md:w-80`
- Horizontal scroll with extended touch area
- PWA manifest for installation

## Testing

### E2E Tests (Playwright)

```bash
npm run test:e2e       # Run tests
npm run test:e2e:ui    # Interactive UI
npm run test:e2e:debug # Debug mode
```

### Test Coverage

- ✅ Add/edit/delete lists
- ✅ Add/edit/delete cards
- ✅ Drag & drop within/between lists
- ✅ Data persistence after reload
- ✅ Mobile responsiveness

## Common Tasks

### Adding a New Feature

1. Update component in `app/page.tsx`
2. Add database changes if needed (migration)
3. Update types in `lib/supabase.ts`
4. Add E2E test in `e2e/kanban.spec.ts`
5. Test with DevTools
6. Update documentation in `/docs`

### Fixing a Bug

1. Reproduce bug in browser
2. Check console errors
3. Check network requests
4. Fix code
5. Verify with DevTools
6. Add E2E test to prevent regression

### Updating Documentation

When making significant changes:
1. Update relevant `/docs/detail/*.md` files
2. Update `/docs/index.md` if architecture changes
3. Update this file (`CLAUDE.md`) if workflow changes

## Environment Variables

Required for Supabase:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
```

Set in:
- Local: `.env.local` (gitignored)
- Vercel: Project settings → Environment Variables

## Deployment

### Vercel Auto-Deploy

Every push to `main` triggers:
```
GitHub → Vercel CI/CD → Build → Deploy → Live
```

### Manual Deploy

```bash
git add .
git commit -m "Description"
git push origin main
```

## Troubleshooting

### Build Fails on Vercel

**Cause**: Missing environment variables

**Fix**: Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel

### Data Not Saving

**Check**:
1. Console errors
2. Network tab → Supabase requests
3. Supabase logs via MCP

**Common causes**:
- Environment variables not set
- RLS policy blocking writes
- Network error (offline)

### Drag & Drop Not Working

**Check**:
1. Touch sensor activation (200ms delay on mobile)
2. `touch-none` class on draggable elements
3. Console errors in dnd-kit

## Important Reminders

### For Claude Code

1. **Always read `/docs`** before making architectural changes
2. **Test with DevTools** before committing
3. **Don't auto-push** unless user confirms
4. **Update docs** when making significant changes
5. **Run E2E tests** for user-facing changes
6. **Check Supabase data** to verify persistence

### Code Style

- Use TypeScript strict mode
- Follow existing patterns in `app/page.tsx`
- Use Tailwind for styling
- Async/await for all Supabase calls
- Handle errors gracefully (log, don't crash)

## Project Structure

```
taesk/
├── app/                  # Next.js App Router
│   ├── page.tsx         # Main Kanban component
│   ├── layout.tsx       # Root layout + PWA
│   └── *.tsx            # Icons
├── lib/
│   └── supabase.ts      # Supabase client + types
├── e2e/
│   └── kanban.spec.ts   # Playwright tests
├── docs/                # Documentation
│   ├── index.md         # Overview
│   └── detail/          # Detailed docs
├── public/
│   └── manifest.json    # PWA manifest
├── playwright.config.ts # Playwright config
└── CLAUDE.md           # This file
```

## Version History

- **v0.1.0**: Initial MVP with Supabase integration
- **Latest**: E2E tests, comprehensive documentation

## Contact & Links

- **Live**: https://taesk.vercel.app
- **Repo**: https://github.com/my151ae/taesk
- **Supabase**: https://your-project-ref.supabase.co

---

**Remember**: Quality over speed. Always verify your changes work correctly before committing.
