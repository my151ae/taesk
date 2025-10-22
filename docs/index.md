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

```bash
# Install dependencies
npm install

# Set up environment variables for development
cp .env.example .env.local
# Add NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY

# Run development server
npm run dev
```

Visit `http://localhost:3000` to see the app.

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

# 3. テストを実行（playwright.config.ts が自動的に .env.test を読み込む）
npx playwright test --reporter=json > playwright-report.json

# 4. 結果確認（推奨: jq コマンド）
cat playwright-report.json | jq '.stats'

# jq がない場合:
tail -20 playwright-report.json | grep -E '"(expected|unexpected|skipped|flaky)"'
```

**テスト成果物**（すべて `.gitignore` に含まれる）:
- `playwright-report.json` - テスト結果
- `playwright/.auth/user.json` - 認証セッション
- `test-results/` - 失敗時のスクリーンショット
- `playwright-report/` - HTML レポート

**Test Coverage (50 tests)**:
- ✅ Auth tests (5/5): Login, logout, profile
- ✅ Kanban tests (37/37): CRUD operations, drag & drop
- ✅ Reorder API tests (8/8): Validation, transactions, concurrent updates
- ✅ RLS tests (optional): Permission enforcement

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

## ✨ Features

### Authentication & Security
- 🔐 **Google OAuth** authentication via Supabase Auth
- 👥 **Shared team board** - all authenticated users can collaborate
- 🛡️ **Protected routes** - automatic redirect to login
- 🚪 **Sign out** functionality with instant feedback
- 💾 **User tracking** - user_id stored for future personal board features

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

### UX Features
- 📱 **Mobile-responsive** design with optimized touch interactions
- 🎨 **Modern UI** with Tailwind CSS
- 🌙 **Dark mode** support (system preference)
- 📲 **PWA** installable on mobile devices
- ⚡ **Optimistic updates** for instant feedback
- 🔄 **Horizontal scrolling** optimized for mobile

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
- **Language**: TypeScript 5

### Backend
- **Database**: Supabase (PostgreSQL)
- **ORM**: Supabase Client (@supabase/supabase-js)
- **Storage**: Hybrid (Supabase + localStorage)

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
│   │   │   └── KanbanBoardClient.tsx      # Core Kanban experience (lists/cards/realtime)
│   │   ├── @modal/(...)c/[short_id]/[[...slug]]/page.tsx  # Intercept hook (locks scroll)
│   │   └── b/[short_id]/[[...slug]]/page.tsx             # SSR + data hydration for boards
│   ├── b/[short_id]/[[...slug]]/page.tsx                  # Canonical board route resolver
│   ├── c/[short_id]/[[...slug]]/page.tsx                  # Standalone card detail page
│   ├── contexts/AuthContext.tsx                           # Supabase auth provider
│   ├── login/page.tsx                                     # Supabase OAuth entry
│   ├── auth/callback/route.ts                             # OAuth callback handler
│   ├── layout.tsx                                         # Root layout, PWA setup
│   └── icon.tsx / apple-icon.tsx                          # Manifest-driven icons
│
├── lib/
│   ├── supabase.ts                    # Typed client + DB interfaces
│   ├── board-utils.ts / card-utils.ts # Short IDs, slug generation, sequencing
│   ├── board-url.ts / card-url.ts     # URL builders + canonical helpers
│   ├── server/boards.ts / cards.ts    # Server utilities for data fetch & normalize
│   └── syncQueue.ts                   # Offline queue + background sync helpers
│
├── public/                             # Static assets (PWA manifest, icons)
│   └── manifest.json
│
├── e2e/
│   ├── .setup/auth-global-setup.ts     # Programmatic Supabase sign-in
│   ├── auth.spec.ts / kanban.spec.ts   # Playwright suites
│   └── rls.spec.ts                     # RLS バリデーション用シナリオ（必要に応じて実行）
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

### 5. Shared Team Board with Authentication
**Decision**: Require authentication but allow all authenticated users to access all data

**Rationale**:
- Team collaboration: everyone sees the same board
- Authentication prevents anonymous vandalism
- user_id is stored for future personal board features
- RLS ensures only authenticated users have access

## 🔗 Quick Links

- [Live Demo](https://taesk.vercel.app/)
- [GitHub Repository](https://github.com/my151ae/taesk)
- [Supabase Documentation](https://supabase.com/docs)
- [Next.js Documentation](https://nextjs.org/docs)

## 📝 License

This project is private and proprietary.
