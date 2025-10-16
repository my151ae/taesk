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
- ✅ Google Authentication (Supabase Auth)
- ✅ Shared team board (all authenticated users collaborate)
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
- [`/docs/detail/routing.md`](./docs/detail/routing.md) - Intercepting routes & canonical URLs
- [`/docs/detail/testing.md`](./docs/detail/testing.md) - Playwright E2E guidelines
- [`/docs/detail/deployment.md`](./docs/detail/deployment.md) - Deployment guide

📋 **Project Management**:
- [`/docs/tickets/README.md`](./docs/tickets/README.md) - タスク管理システムのルール
- [`/docs/roadmap.md`](./docs/roadmap.md) - 最新のハイライト
- 詳細ロードマップ: `/docs/tickets/YYYY-MM-DD/roadmap.md`

**IMPORTANT: When creating tickets or documentation:**
- **Always use the current date** from the `<env>` context (Today's date: YYYY-MM-DD)
- Create ticket directories as `/docs/tickets/YYYY-MM-DD/` using the current date
- Never use dates from previous sessions or arbitrary dates

**Always refer to these docs when working on Taesk to understand the full context.**

## Development Workflow

### Before Starting Work

1. **Read relevant documentation** from `/docs` to understand the system
2. **Check existing code** in `app/(board)/_components/KanbanBoardClient.tsx`（メインのクライアントロジック）
3. **Review database schema** in Supabase or docs

### During Development

1. **Make code changes**
2. **Verify dev server is running** (`npm run dev`)
3. **Test in browser** with DevTools (use chrome-devtools MCP)
4. **Check for errors/warnings** in console
5. **Fix any issues** before proceeding
6. **Run E2E tests** if relevant (`npx playwright test --reporter=json > playwright-report.json`)

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

**IMPORTANT: ALWAYS ask for user confirmation before committing and pushing.**

Workflow:
1. Make changes
2. Test locally with browser DevTools
3. **Show the user what you did and ask for confirmation**
4. **ONLY after user says "OK" or "push" or "commit"**, then commit and push
5. **NEVER commit and push automatically** even if tests pass

Example:
```
Claude: "I've implemented X. Here's what changed: [summary].
        Tests are passing. Should I commit and push this?"
User: "yes" or "push it" or "ok"
Claude: [commits and pushes]
```

## Architecture Overview

### Component Structure

```
app/layout.tsx
└── app/(board)/layout.tsx (@modal parallel route)
    └── KanbanBoardClient (client component)
        ├── Header (board selector, filters, sync status)
        ├── DndContext (@dnd-kit)
        │   ├── SortableList × N
        │   │   └── SortableCard × M
        │   └── “+ Add List” button
        └── CardModal (selectedCardId が存在するときのみ)
```

### Data Flow

```
User Action
  ↓
Update React State (optimistic UI)
  ↓
Persist to localStorage (`kanban_board_data`)
  ↓
Online? → `syncToSupabase(newData)`
Offline? → `addToSyncQueue({ type, table, data })`
```

### Storage Layers

1. **React State**: In-memory, for UI (KanbanBoardClient)
2. **localStorage**: Client cache, offline support (`saveToStorage`)
3. **syncQueue.ts**: Offline queue（INSERT/UPDATE/DELETE）
4. **Supabase**: Cloud persistence + Realtime

## Database Schema

### Tables (key fields)

- **boards**: `id`, `name`, `short_id`, `id_short`, `slug`, `is_test_board`, timestamps
- **lists**: `id`, `title`, `position`, `board_id`, `user_id`, timestamps
- **cards**: `id`, `title`, `description`, `list_id`, `board_id`, `tags[]`, `due_date`, `priority`, `assignee_id`, `short_id`, `id_short`, `slug`, timestamps（`assigned_to` は legacy）
- **activity_logs**: ボードごとの監査ログ（`action`, `entity_type`, `details`）

### Relationships

- board 1 → n lists / cards / activity_logs
- list 1 → n cards
- `ON DELETE CASCADE` により親削除で子レコードも削除

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

- Touch sensors with activation delay (350ms)
- Responsive widths: `w-72 md:w-80`
- Horizontal scroll with extended touch area
- PWA manifest for installation

## Testing

### E2E Tests (Playwright)

```bash
npx playwright test --reporter=json > playwright-report.json
# 必要に応じて JSON を python / node で解析
```

### Test Coverage

- ✅ Add/edit/delete lists
- ✅ Add/edit/delete cards
- ✅ Drag & drop within/between lists
- ✅ Data persistence after reload
- ✅ Mobile responsiveness

## Common Tasks

### Adding a New Feature

1. Update component(s) in `app/(board)/_components/KanbanBoardClient.tsx`
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
1. Touch sensor activation (350ms delay on mobile)
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
- Follow existing patterns in `app/(board)/_components/KanbanBoardClient.tsx`
- Use Tailwind for styling
- Async/await for all Supabase calls
- Handle errors gracefully (log, don't crash)

## Project Structure

```
taesk/
├── app/
│   ├── (board)/
│   │   ├── page.tsx                  # / → canonical board redirect
│   │   ├── layout.tsx                # @modal parallel route
│   │   └── _components/KanbanBoardClient.tsx
│   ├── b/[short_id]/[[...slug]]/page.tsx   # Board canonical route
│   ├── c/[short_id]/[[...slug]]/page.tsx   # Card standalone page
│   ├── contexts/AuthContext.tsx
│   ├── login/page.tsx
│   └── icon.tsx / apple-icon.tsx
├── lib/
│   └── supabase.ts      # Supabase client + types
├── e2e/
│   ├── .setup/auth-global-setup.ts
│   ├── auth.spec.ts / kanban.spec.ts / rls.spec.ts
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
