# Claude Code Workflow Rules for Taesk

## Project Overview

**Taesk** is a modern, mobile-first PWA Kanban board application built with Next.js 15, React 18, Supabase, and dnd-kit.

### Tech Stack
- **Frontend**: Next.js 15 (App Router), React 18, TypeScript
- **Styling**: Tailwind CSS 3
- **Drag & Drop**: @dnd-kit/core + @dnd-kit/sortable
- **State Management**: Zustand (for comments & notifications)
- **Validation**: Zod
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth (@supabase/ssr)
- **Storage**: Hybrid (Supabase + localStorage)
- **Edge Functions**: Supabase Edge Functions (Web Push)
- **Cache**: Vercel KV
- **Testing**: Playwright (E2E)
- **Deployment**: Vercel

### Key Features
- ✅ Google Authentication (Supabase Auth)
- ✅ Board sharing & permissions (owner/editor/commenter/viewer)
- ✅ Drag & drop cards and lists
- ✅ Inline editing of cards and lists
- ✅ Multi-assignee support
- ✅ Comments system with threaded replies
- ✅ @Mentions with typeahead
- ✅ In-app notifications (real-time)
- ✅ Foreground notification sound with Web Audio (800Hz / 200ms fade)
- ✅ Web Push notifications with preferences
- ✅ Quiet hours & timezone support
- ✅ Hybrid storage (offline-first)
- ✅ Mobile-responsive with PWA support
- ✅ Auto-save to Supabase
- ✅ Comprehensive E2E test coverage

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

> ⚠️ **環境制約（厳守）**: `npm run dev`・`NODE_ENV=test npm run dev` を含む手動サーバー起動は全面禁止。検証は Playwright JSON レポートと chrome-devtools MCP で行い、必要なログは JSON 解析（`jq` / `sed`）経由で取得すること。

## Development Workflow

### Before Starting Work

1. **Read relevant documentation** from `/docs` to understand the system
2. **Check existing code** in `app/(board)/_components/KanbanBoardClient.tsx`（メインのクライアントロジック）
3. **Review database schema** in Supabase or docs

### During Development

1. **コードを更新**し、関連ドキュメントを即時に追随させる
2. **Playwright E2E（JSONレポート必須）で挙動を確認**  
   - `npx playwright test --reporter=json > playwright-report.json`
   - `cat playwright-report.json | jq '.stats'` で結果確認  
   - 必要に応じて `sed -n '/^{/,$p'` を挟み、JSON開始前のログを除去
3. **chrome-devtools MCP でレンダリングとコンソールログを確認**（サーバー起動は禁止のためブラウザはMCPで確認）
4. **通知音などブラウザ依存機能**は `NotificationSettings` の「音声を有効化」「テスト音を再生」ボタンで検証し、ログを記録
5. **lint / type check** (`npm run lint`) を実行し、警告を解消
6. **必要に応じてAPIログ**や `test-summary.js` で補助的な解析を行う

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
        ├── Header
        │   ├── Board selector & create board
        │   ├── Search & filters (tags, priority, assignees)
        │   ├── NotificationsBell (in-app notifications)
        │   ├── NotificationSettings (preferences, quiet hours, Web Push)
        │   └── Sync status (Live / Queued)
        ├── DndContext (@dnd-kit)
        │   ├── SortableList × N
        │   │   ├── List header (title, menu, ShareDialog)
        │   │   └── SortableCard × M
        │   └── "+ Add List" button
        ├── CardModal (selectedCardId が存在するときのみ)
        │   ├── Details tab (title, description, tags, due date, priority, assignees)
        │   └── Comments tab (CommentsPanel with @Mentions)
        └── NotificationSoundPlayer (Service Worker → Web Audio連携のサウンド再生)
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

### Notification Audio Pipeline

1. **NotificationSettings** (`app/(board)/_components/NotificationSettings.tsx`)
   - 「音声を有効化」ボタンで `unlockAudio()` を呼び出し、Chromeのautoplay制限を解除
   - 「テスト音を再生」ボタンで `playNotificationSound()` を直接実行し、800Hz/200msフェードのビープを確認
2. **lib/notification-audio.ts**
   - Web Audio API の `AudioContext` を単一インスタンスで管理
   - サイン波オシレーター (800Hz) + `GainNode` の指数フェード (0.2s) で WAV データURL依存を解消
3. **NotificationSoundPlayer**
   - Service Worker から `NOTIFICATION_RECEIVED` メッセージを受信
   - タブが `visible` かつ audio unlocked のときだけ `playNotificationSound()` を実行
4. **Service Worker (`public/sw.js`)**
   - Pushイベントで `renotify: true` / `silent: false` を設定しつつ、前述のメッセージを送信
   - バックグラウンドでは OS 標準音、フォアグラウンドでは Web Audio のビープで二重通知を防止
4. **Supabase**: Cloud persistence + Realtime

## Database Schema

### Tables (key fields)

**Core Tables:**
- **boards**: `id`, `name`, `short_id`, `id_short`, `slug`, `is_test_board`, timestamps
- **lists**: `id`, `title`, `position`, `board_id`, `user_id`, timestamps
- **cards**: `id`, `title`, `description`, `list_id`, `board_id`, `tags[]`, `due_date`, `priority`, `assignee_id`, `assignee_ids[]`, `short_id`, `id_short`, `slug`, timestamps
- **profiles**: `id`, `full_name`, `avatar_url`, `email`, timestamps
- **activity_logs**: ボードごとの監査ログ（`action`, `entity_type`, `details`）

**Collaboration Tables (Phase 3):**
- **board_members**: `board_id`, `profile_id`, `role` (owner/editor/commenter/viewer), `created_at`
- **board_invites**: `id`, `board_id`, `email`, `role`, `token`, `expires_at`, `accepted_at`
- **comments**: `id`, `card_id`, `author_id`, `parent_id`, `body`, `mentions[]`, `deleted_at`, timestamps
- **notifications**: `id`, `recipient_id`, `type`, `payload` (JSONB), `read_at`, `dedupe_key`, `created_at`
- **push_subscriptions**: `id`, `profile_id`, `endpoint`, `p256dh`, `auth`, `user_agent`, `failure_count`, timestamps
- **notification_delivery_logs**: `id`, `notification_id`, `subscription_id`, `status`, `error`, `created_at`

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

**前提条件**:
1. **`.env.test` ファイルが必須** - プロジェクトルートに配置（`.env.example` を参考に作成）
2. 以下の環境変数を設定:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   SUPABASE_SERVICE_ROLE_KEY=replace-with-your-supabase-service-role-key
   E2E_ENABLED=true
   E2E_SECRET=redacted-e2e-secret
   E2E_USER_EMAIL=e2e.taesk.test@gmail.com
   E2E_USER_PASSWORD=replace-with-local-test-password
   ```

**実行方法**（タグベース）:
```bash
# CI必須テスト（@e2e:essential）
npm test

# 機能別テスト
npm run test:feature:boards      # ボード機能
npm run test:feature:comments    # コメント・@メンション
npm run test:feature:notifications  # 通知機能

# 異常系テスト
npm run test:failure

# 全テスト実行
npm run test:full

# JSON統計確認
npm run test:summary
```

**テスト成果物**（すべて `.gitignore` に含まれる）:
- `playwright-report.json` - テスト結果（JSON）
- `playwright/.auth/user.json` - 認証セッション
- `test-results/` - 失敗時のスクリーンショット
- `playwright-report/` - HTML レポート

### Test Coverage (83 tests)

| カテゴリ | ファイル | テスト数 |
|---|---|---|
| 認証 | auth.spec.ts | 5 |
| ボード・リスト・カード | kanban.spec.ts | 37 |
| 並び替えAPI | reorder-api.spec.ts | 11 |
| コメント・@メンション | comments.spec.ts | 8 |
| 通知（Web Push、In-app） | notifications.spec.ts | 6 |
| ボード権限管理 | board-permissions.spec.ts | 5 |
| RLSセキュリティ | rls.spec.ts | 6 |
| 招待機能（未実装） | invites.spec.ts | 5 (skip) |

**タグ体系**:
- `@e2e:essential` - CI必須（約20テスト）
- `@feature:*` - 機能別（boards, lists, comments, notifications）
- `@failure:*` - 異常系（validation, permissions, notificationsなど）
- `@phase3` - 未実装機能（スキップ対象）

**詳細**: `/docs/detail/testing.md` を参照

## Common Tasks

### Adding a New Feature

1. Update component(s) in `app/(board)/_components/KanbanBoardClient.tsx` or create new components
2. Add database changes if needed (migration in `supabase/migrations/`)
3. Update types in `lib/supabase.ts`
4. If using Zustand, create or update store in `app/(board)/_stores/`
5. Add API routes if needed in `app/api/`
6. Add E2E test in appropriate spec file (`e2e/*.spec.ts`)
7. Test with DevTools (console, network, Supabase data)
8. Update documentation in `/docs`

### Working with Comments & Notifications

**Comments**:
- Store: `app/(board)/_stores/comments-store.ts` (optimistic updates, offline queue)
- UI: `app/(board)/_components/CommentsPanel.tsx` (threaded view, replies, editing)
- API: `app/api/comments/` (CRUD, nested replies)
- Realtime: Supabase Realtime subscription in comments store

**Notifications**:
- Store: `app/(board)/_stores/notifications-store.ts`
- UI: `app/(board)/_components/NotificationsBell.tsx` (tabs, drawer)
- Preferences: `app/(board)/_components/NotificationSettings.tsx`
- API: `app/api/notifications/` (preferences, mark-read, test)
- Server: `lib/server/notifications.ts` (creation logic, quiet hours)
- Edge Function: `supabase/functions/send-push-notification/` (Web Push delivery)

### Fixing a Bug

1. Reproduce bug in browser
2. Check console errors
3. Check network requests
4. Check Supabase logs via MCP (`mcp__supabase__get_logs`)
5. Fix code
6. Verify with DevTools
7. Add E2E test to prevent regression

### Updating Documentation

When making significant changes:
1. Update relevant `/docs/detail/*.md` files
2. Update `/docs/index.md` if architecture changes
3. Update this file (`CLAUDE.md`) if workflow changes
4. Update `/docs/roadmap.md` for feature progress

## Environment Variables

### Development (`.env.local`)

Required for Supabase:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
```

Optional for Web Push notifications:
```bash
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-vapid-public-key
```

### Testing (`.env.test`)

**Required for E2E tests** - see Testing section above for full details.

### Production (Vercel)

Set in: Vercel Project Settings → Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (for Web Push notifications)

### Supabase Edge Functions

Set in: Supabase Dashboard → Edge Functions → Secrets
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (e.g., `mailto:your-email@example.com`)

**Note**: All `.env*` files are gitignored except `.env.example`

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
2. **Test with DevTools** before committing (console, network, Supabase data)
3. **Don't auto-push** unless user confirms
4. **Update docs** when making significant changes
5. **Run E2E tests** for user-facing changes
6. **Check Supabase data** to verify persistence
7. **Use Zustand stores** for comments & notifications (not React state)
8. **Check API routes** in `app/api/` before creating new ones
9. **Test Web Push** locally requires VAPID keys in environment
10. **Use MCP tools** to verify Supabase logs and data

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
│   │   ├── _components/
│   │   │   ├── KanbanBoardClient.tsx
│   │   │   ├── NotificationsBell.tsx
│   │   │   ├── NotificationSettings.tsx
│   │   │   ├── CommentsPanel.tsx
│   │   │   ├── Mention.tsx
│   │   │   └── ShareDialog.tsx
│   │   └── _stores/
│   │       ├── comments-store.ts
│   │       └── notifications-store.ts
│   ├── api/
│   │   ├── boards/                   # Board CRUD & data endpoints
│   │   ├── comments/                 # Comment CRUD & replies
│   │   ├── notifications/            # Notification preferences & mark-read
│   │   ├── push-subscriptions/       # Web Push subscription management
│   │   └── profiles/                 # User profile search
│   ├── b/[short_id]/[[...slug]]/page.tsx   # Board canonical route
│   ├── c/[short_id]/[[...slug]]/page.tsx   # Card standalone page
│   ├── contexts/AuthContext.tsx
│   ├── components/CardModal.tsx
│   ├── login/page.tsx
│   └── icon.tsx / apple-icon.tsx
├── lib/
│   ├── supabase.ts                   # Supabase client + types
│   ├── server/
│   │   ├── boards.ts / cards.ts
│   │   └── notifications.ts          # Notification creation & quiet hours
│   └── push-notifications.ts         # Web Push helpers
├── public/
│   ├── manifest.json                 # PWA manifest
│   └── sw.js                         # Service Worker for push notifications
├── supabase/
│   ├── functions/
│   │   └── send-push-notification/   # Edge Function for Web Push
│   └── migrations/                   # Database migrations
├── e2e/
│   ├── .setup/auth-global-setup.ts
│   ├── auth.spec.ts / kanban.spec.ts / rls.spec.ts
│   ├── phase3-comments.spec.ts
│   └── phase3-webpush.spec.ts
├── docs/                             # Documentation
│   ├── index.md                      # Overview
│   └── detail/                       # Detailed docs
│       ├── notifications.md          # Notification system docs
│       └── ...
├── playwright.config.ts              # Playwright config
└── CLAUDE.md                         # This file
```

## Version History

- **v0.1.0** (Phase 1): Initial MVP with Supabase integration, basic Kanban functionality
- **v0.2.0** (Phase 2): Multiple boards, card tags, due dates, priorities, assignees, short URLs
- **v0.3.0** (Phase 3): Collaboration features - comments, @mentions, notifications, Web Push, board sharing
- **Latest**: Phase 3 complete with comprehensive E2E tests and documentation

## Contact & Links

- **Live**: https://taesk.vercel.app
- **Repo**: https://github.com/my151ae/taesk
- **Supabase**: https://your-project-ref.supabase.co

---

**Remember**: Quality over speed. Always verify your changes work correctly before committing.
