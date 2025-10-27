# Taesk - Kanban Board Documentation

> A modern, mobile-first PWA Kanban board built with Next.js, Supabase, and dnd-kit

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Detailed Documentation](#detailed-documentation)

## 🚀 Quick Start

> ⚠️ **最優先ルール**: `npm run dev` / `NODE_ENV=test npm run dev` を含む手動サーバー起動は禁止。検証は Playwright JSON レポートと chrome-devtools MCP で行う。

```bash
# Install dependencies
npm install

# Prepare environment variables
cp .env.example .env.local
# Populate NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY など

# Static analysis
npm run lint

# Production bundle
npm run build

# Verification (JSON必須)
npx playwright test --reporter=json > playwright-report.json
cat playwright-report.json | jq '.stats'
```

UIのレンダリング確認は chrome-devtools MCP でスナップショット/ネットワーク/コンソールを取得して行う。

### 🔊 Notification Sound Check

通知関連の検証手順:

1. `NotificationSettings` セクションで **「音声を有効化」** ボタンを押し、Web Audio の `AudioContext` をアンロック
2. **「🎵 テスト音を再生」** をクリックし、800Hz / 200ms フェードアウトのビープが鳴ることを確認
3. Service Worker からの通知を確認したい場合は `showTestNotification()` を実行し、前景タブで `NotificationSoundPlayer` がサウンドを再生すること、背景タブではOS標準通知音のみ鳴ることをログで検証

ビープ生成は `lib/notification-audio.ts` の Web Audio オシレーター実装に統一され、過去のデータURL(WAV)依存は排除されている。

### Running E2E Tests

**前提条件**: `.env.test` ファイルが必須

```bash
# 1. .env.test ファイルを作成（存在しない場合）
cp .env.example .env.test

# 2. .env.test を編集して実際の値を設定:
#   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...  # 実際の値
#   SUPABASE_SERVICE_ROLE_KEY=replace-with-your-supabase-service-role-key      # 実際の値
#   E2E_ENABLED=true
#   E2E_SECRET=redacted-e2e-secret
#   E2E_USER_EMAIL=e2e.taesk.test@gmail.com
#   E2E_USER_PASSWORD=replace-with-local-test-password

# 3. テストを実行（タグベース）
# CI必須テスト（@e2e:essential）
npm test

# 機能別テスト
npm run test:feature:boards       # ボード機能
npm run test:feature:comments     # コメント・@メンション
npm run test:feature:notifications  # 通知機能

# 異常系テスト
npm run test:failure

# 全テスト実行
npm run test:full

# JSON統計確認
npm run test:summary
```

**テスト成果物**（すべて `.gitignore` に含まれる）:
- `playwright-report.json` - テスト結果（JSON形式）
- `playwright/.auth/user.json` - 認証セッション
- `test-results/` - 失敗時のスクリーンショット
- `playwright-report/` - HTML レポート

**Test Coverage (83 tests)** - ✅ **100% Stable**:
- ✅ Auth tests (5): Login, logout, session management
- ✅ Kanban tests (37): CRUD operations, drag & drop, multi-assignee, position normalization
- ✅ Reorder API tests (11): Validation (DUPLICATE_POSITION, UNKNOWN_ID, CROSS_BOARD), transactions, concurrent updates
- ✅ Comments tests (8): Threaded comments, @mentions typeahead, realtime sync, UUID validation
- ✅ Notifications tests (6): In-app notifications, Web Push, unread badge
- ✅ Board permissions tests (5): ShareDialog, member management, role changes
- ✅ RLS tests (6): Security policy validation

**Test Stability Features**:
- 🔄 Unique board per test (prevents cross-test interference)
- 🚫 Realtime disabled in test environment (`NEXT_PUBLIC_DISABLE_REALTIME=true`)
- 🎯 Precise selectors (`[data-type="list"]` to avoid dropzone double-matching)
- 🔁 Drag error rollback implemented in client code (`handleDragEnd` restores `previousData` on sync failure)
- 📏 Position normalization (1000/10 gaps) enforced in `initializeDefaultLists` and `handleAddList`

**タグ体系**:
- `@e2e:essential` - CI必須の最小セット（約20テスト）
- `@feature:*` - 機能別（boards, lists, comments, notifications）
- `@failure:*` - 異常系テスト（validation, permissions, notificationsなど）
- `@phase3` - 未実装機能（スキップ対象）

**詳細**: [`/docs/detail/testing.md`](./detail/testing.md) を参照

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   User Interface                    │
│              (Next.js 15 + React 18)                │
│        PWA-enabled, Mobile-responsive UI            │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              State Management                        │
│         (React Hooks + Local State)                 │
│    ┌──────────────┐      ┌──────────────┐          │
│    │ Drag & Drop  │      │  Board Data  │          │
│    │  (dnd-kit)   │      │    (Cards,   │          │
│    │              │      │    Lists)    │          │
│    └──────────────┘      └──────────────┘          │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│           Hybrid Storage Layer                       │
│  ┌────────────────────┐  ┌────────────────────┐    │
│  │   localStorage     │  │    Supabase        │    │
│  │   (Cache/Offline)  │  │  (Cloud Sync)      │    │
│  │                    │  │                    │    │
│  │  • Instant reads   │  │  • Persistence     │    │
│  │  • Offline support │  │  • Multi-device    │    │
│  │  • Fast initial    │  │  • Real backup     │    │
│  │    load            │  │                    │    │
│  └────────────────────┘  └────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### Data Flow

1. **Initial Load**: Fetch from Supabase → Cache in localStorage → Render
2. **User Action**: Update UI → Save to localStorage → Sync to Supabase
3. **Offline Mode**: Update UI → Save to localStorage → Sync when online
4. **Page Reload**: Load from Supabase → Update cache → Render

### Notification Audio Flow

- `NotificationSettings` が Web Audio のアンロックとテスト再生を提供（`unlockAudio`, `playNotificationSound`）
- `NotificationSoundPlayer` コンポーネントが Service Worker からの `NOTIFICATION_RECEIVED` メッセージを受け、タブが `visible` かつ audio unlocked の場合のみ 800Hz ビープを再生
- Service Worker (`public/sw.js`) は引き続き `silent: false` / `renotify: true` を指定しつつ、前景タブへ postMessage することで OS 通知音 + Web Audio ビープを併用

## ✨ Features

### Authentication & Security
- 🔐 **Google OAuth** authentication via Supabase Auth
- 👥 **Board sharing & permissions** - owner/editor/commenter/viewer roles
- 🛡️ **Protected routes** - automatic redirect to login
- 🚪 **Sign out** functionality with instant feedback
- 💾 **User tracking** - user_id stored for personal board features
- 🔒 **Row Level Security (RLS)** - role-based access control

### Core Functionality
- ✅ **Create, Read, Update, Delete** lists and cards
- ✅ **Drag & Drop** for cards (within/between lists) and lists
- ✅ **Edit in-place** for card titles, descriptions, and list names
- ✅ **Delete with confirmation** for lists and cards
- ✅ **Auto-save** to Supabase on every change
- ✅ **Offline-first** with localStorage cache
- ✅ **Trello-style card URLs** with short IDs and SEO-friendly slugs
- ✅ **Modal card view** with Intercepting Routes (board context preserved)
- ✅ **Standalone card pages** for direct URL access and sharing
- ✅ **308 Permanent Redirect** for canonical URL normalization
- ✅ **Multi-assignee support** - assign multiple users to cards

### Collaboration Features (Phase 3)
- 💬 **Comments system** - threaded comments with replies
- 📢 **@Mentions** - mention users in comments with typeahead
- 🔔 **In-app notifications** - real-time notifications for mentions and comments
- 📲 **Web Push notifications** - browser push notifications with user preferences
- 🔕 **Quiet hours** - configure notification quiet hours with timezone support
- 👥 **Board member management** - add/remove members and manage roles
- 🔄 **Real-time sync** - Supabase Realtime for live comment updates

### UX Features
- 📱 **Mobile-responsive** design with optimized touch interactions
- 🎨 **Modern UI** with Tailwind CSS
- 🌙 **Dark mode** support (system preference)
- 📲 **PWA** installable on mobile devices
- ⚡ **Optimistic updates** for instant feedback
- 🔄 **Horizontal scrolling** optimized for mobile
- 🔊 **Foreground notification beep** powered by Web Audio (800Hz / 200msフェード)

### Technical Features
- 🗄️ **PostgreSQL** database via Supabase
- 🔐 **Row Level Security** (RLS) with strict policies
- 📡 **RESTful API** via Supabase
- 🧪 **E2E testing** with Playwright (auth + RLS tests)
- 📝 **TypeScript** for type safety
- 🚀 **Vercel** deployment ready

## 🛠️ Tech Stack

### Frontend
- **Framework**: Next.js 15 (App Router)
- **UI Library**: React 18
- **Styling**: Tailwind CSS 3
- **Drag & Drop**: @dnd-kit/core + @dnd-kit/sortable
- **State Management**: Zustand (for comments & notifications)
- **Validation**: Zod
- **Language**: TypeScript 5

### Backend
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth (@supabase/ssr)
- **ORM**: Supabase Client (@supabase/supabase-js)
- **Storage**: Hybrid (Supabase + localStorage)
- **Edge Functions**: Supabase Edge Functions (for Web Push)
- **Cache**: Vercel KV

### DevOps
- **Testing**: Playwright (E2E)
- **Linting**: ESLint + eslint-config-next
- **Deployment**: Vercel
- **Version Control**: Git + GitHub

## 📁 Project Structure

```
taesk/
├── app/
│   ├── (board)/
│   │   ├── page.tsx                       # Redirects top-level / → canonical board URL
│   │   ├── layout.tsx                     # Provides @modal parallel route for card modal
│   │   ├── _components/
│   │   │   ├── KanbanBoardClient.tsx      # Core Kanban experience (lists/cards/realtime)
│   │   │   ├── NotificationsBell.tsx      # Notification center UI (tabs/drawer)
│   │   │   ├── NotificationSettings.tsx   # Notification preferences & quiet hours
│   │   │   ├── CommentsPanel.tsx          # Comments UI with replies & editing
│   │   │   ├── Mention.tsx                # @Mention component with typeahead
│   │   │   └── ShareDialog.tsx            # Board member management UI
│   │   ├── _stores/
│   │   │   ├── comments-store.ts          # Zustand store for comments (optimistic updates)
│   │   │   └── notifications-store.ts     # Zustand store for notifications
│   │   ├── @modal/(...)c/[short_id]/[[...slug]]/page.tsx  # Intercept hook (locks scroll)
│   │   └── b/[short_id]/[[...slug]]/page.tsx             # SSR + data hydration for boards
│   ├── api/
│   │   ├── boards/                        # Board CRUD & data endpoints
│   │   ├── comments/                      # Comment CRUD & nested replies
│   │   ├── notifications/                 # Notification preferences & mark-read
│   │   ├── push-subscriptions/            # Web Push subscription management
│   │   └── profiles/                      # User profile search
│   ├── b/[short_id]/[[...slug]]/page.tsx  # Canonical board route resolver
│   ├── c/[short_id]/[[...slug]]/page.tsx  # Standalone card detail page
│   ├── contexts/AuthContext.tsx           # Supabase auth provider
│   ├── components/CardModal.tsx           # Card modal with Details/Comments tabs
│   ├── login/page.tsx                     # Supabase OAuth entry
│   ├── auth/callback/route.ts             # OAuth callback handler
│   ├── layout.tsx                         # Root layout, PWA setup
│   └── icon.tsx / apple-icon.tsx          # Manifest-driven icons
│
├── lib/
│   ├── supabase.ts                    # Typed client + DB interfaces
│   ├── board-utils.ts / card-utils.ts # Short IDs, slug generation, sequencing
│   ├── board-url.ts / card-url.ts     # URL builders + canonical helpers
│   ├── server/
│   │   ├── boards.ts / cards.ts       # Server utilities for data fetch & normalize
│   │   └── notifications.ts           # Notification creation & quiet hours logic
│   ├── push-notifications.ts          # Web Push helper functions
│   └── syncQueue.ts                   # Offline queue + background sync helpers
│
├── public/                             # Static assets (PWA manifest, icons, Service Worker)
│   ├── manifest.json
│   └── sw.js                           # Service Worker for push notifications
│
├── supabase/
│   ├── functions/
│   │   └── send-push-notification/    # Edge Function for Web Push delivery
│   └── migrations/                     # Database migration files
│
├── e2e/
│   ├── .setup/auth-global-setup.ts     # Programmatic Supabase sign-in
│   ├── auth.spec.ts                    # Authentication & session tests (@e2e:essential)
│   ├── kanban.spec.ts                  # Board/list/card CRUD & D&D (@feature:boards)
│   ├── reorder-api.spec.ts             # List/card reorder API tests (@feature:lists)
│   ├── comments.spec.ts                # Comments & @mentions (@feature:comments)
│   ├── notifications.spec.ts           # Web Push & in-app notifications (@feature:notifications)
│   ├── board-permissions.spec.ts       # ShareDialog & member management (@feature:boards)
│   ├── invites.spec.ts                 # Invite flow (未実装、@phase3)
│   └── rls.spec.ts                     # RLS policy validation (@e2e:essential)
│
├── playwright/.auth/user.json          # Persisted auth state for Playwright
├── docs/                               # Documentation hub (details below)
├── playwright.config.ts                # Playwright configuration (dev server, auth)
├── tailwind.config.ts
├── tsconfig.json
└── next.config.ts
```

## 📚 Detailed Documentation

### Core Concepts
- [Architecture & Design](./detail/architecture.md) - System design and patterns
- [Database Schema](./detail/database.md) - Supabase tables and relationships
- [Storage Strategy](./detail/storage.md) - Hybrid storage implementation
- [Component Structure](./detail/components.md) - React components breakdown
- [Routing & Card URLs](./detail/routing.md) - Intercepting Routes, modal views, canonical URLs
- [Notifications](./detail/notifications.md) - Preferences, quiet hours, Web Push delivery

### Development
- [Testing Guide](./detail/testing.md) - E2E testing with Playwright, best practices

### Setup
- [Local Development](./setup/local-dev.md) - Environment variables, Service Worker & push setup

### Operations
- [Deployment Guide](./detail/deployment.md) - Vercel deployment steps

### Project Management
- [Tickets System](./tickets/README.md) - タスク管理システムの使い方
- [Roadmap](./roadmap.md) - 最新版ロードマップ（単一ドキュメント）

## 🎯 Key Design Decisions

### 1. Hybrid Storage
**Decision**: Use both Supabase and localStorage

**Rationale**:
- Supabase: Cloud persistence, multi-device sync
- localStorage: Fast reads, offline support, instant UI updates

### 2. Optimistic UI Updates
**Decision**: Update UI immediately, then sync to backend

**Rationale**:
- Better UX with instant feedback
- localStorage ensures no data loss
- Async Supabase sync in background

### 3. Mobile-First Design
**Decision**: Optimize for mobile screens first

**Rationale**:
- PWA target is mobile users
- Touch interactions need special handling
- Horizontal scrolling for multiple lists

### 4. Google OAuth Authentication
**Decision**: Use Supabase Auth with Google OAuth provider

**Rationale**:
- No password management needed
- Secure, industry-standard OAuth flow
- Easy UX (one-click login)
- Supabase handles all complexity

### 5. Board Sharing & Role-Based Access Control (Phase 3)
**Decision**: Implement granular permissions with owner/editor/commenter/viewer roles

**Rationale**:
- Flexible collaboration: different permission levels for different team members
- Privacy: boards are only visible to invited members
- RLS policies enforce role-based access at database level
- Future-proof for personal boards and team workspaces

### 6. Zustand for Collaboration State (Phase 3)
**Decision**: Use Zustand stores for comments and notifications

**Rationale**:
- Optimistic updates for instant UI feedback
- Offline queue for comments and notifications
- Real-time sync with Supabase Realtime
- Separation of concerns: board data vs. collaboration data

### 7. Web Push with Edge Functions (Phase 3)
**Decision**: Implement Web Push notifications using Supabase Edge Functions

**Rationale**:
- Native browser notifications for better engagement
- Edge Functions handle VAPID key management securely
- Quiet hours and preferences respected server-side
- Delivery logs for observability and rate limiting

## 🔗 Quick Links

- [Live Demo](https://taesk.vercel.app/)
- [GitHub Repository](https://github.com/my151ae/taesk)
- [Supabase Documentation](https://supabase.com/docs)
- [Next.js Documentation](https://nextjs.org/docs)

## 📝 License

This project is private and proprietary.
