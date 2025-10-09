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

# Set up environment variables
cp .env.example .env.local
# Add your Supabase URL and keys

# Run development server
npm run dev

# Run E2E tests
npm run test:e2e
```

Visit `http://localhost:3000` to see the app.

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

### Core Functionality
- ✅ **Create, Read, Update, Delete** lists and cards
- ✅ **Drag & Drop** for cards (within/between lists) and lists
- ✅ **Edit in-place** for card titles, descriptions, and list names
- ✅ **Delete with confirmation** for lists and cards
- ✅ **Auto-save** to Supabase on every change
- ✅ **Offline-first** with localStorage cache

### UX Features
- 📱 **Mobile-responsive** design with optimized touch interactions
- 🎨 **Modern UI** with Tailwind CSS
- 🌙 **Dark mode** support (system preference)
- 📲 **PWA** installable on mobile devices
- ⚡ **Optimistic updates** for instant feedback
- 🔄 **Horizontal scrolling** optimized for mobile

### Technical Features
- 🗄️ **PostgreSQL** database via Supabase
- 🔐 **Row Level Security** (RLS) enabled
- 📡 **RESTful API** via Supabase
- 🧪 **E2E testing** with Playwright
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
├── app/                      # Next.js App Router
│   ├── layout.tsx           # Root layout with PWA config
│   ├── page.tsx             # Main Kanban board component
│   ├── icon.tsx             # App icon generator
│   └── apple-icon.tsx       # Apple touch icon
│
├── lib/                      # Shared utilities
│   └── supabase.ts          # Supabase client & types
│
├── public/                   # Static assets
│   └── manifest.json        # PWA manifest
│
├── e2e/                      # End-to-end tests
│   └── kanban.spec.ts       # Playwright test suite
│
├── docs/                     # Documentation
│   ├── index.md             # This file
│   └── detail/              # Detailed documentation
│       ├── architecture.md  # System architecture
│       ├── database.md      # Database schema
│       ├── components.md    # Component structure
│       ├── storage.md       # Storage strategy
│       └── deployment.md    # Deployment guide
│
├── playwright.config.ts      # Playwright configuration
├── tailwind.config.ts        # Tailwind configuration
├── tsconfig.json             # TypeScript configuration
└── next.config.ts            # Next.js configuration
```

## 📚 Detailed Documentation

### Core Concepts
- [Architecture & Design](./detail/architecture.md) - System design and patterns
- [Database Schema](./detail/database.md) - Supabase tables and relationships
- [Storage Strategy](./detail/storage.md) - Hybrid storage implementation

### Development
- [Component Structure](./detail/components.md) - React components breakdown
- [State Management](./detail/state-management.md) - How data flows
- [Drag & Drop](./detail/drag-drop.md) - dnd-kit implementation

### Operations
- [Deployment Guide](./detail/deployment.md) - Vercel deployment steps
- [Testing Guide](./detail/testing.md) - Running E2E tests
- [Troubleshooting](./detail/troubleshooting.md) - Common issues

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

### 4. No Authentication (Yet)
**Decision**: Public board with RLS allowing all operations

**Rationale**:
- MVP focus on core functionality
- Easy to add auth later (Supabase Auth)
- Current RLS setup is auth-ready

## 🔗 Quick Links

- [Live Demo](https://taesk.vercel.app/)
- [GitHub Repository](https://github.com/my151ae/taesk)
- [Supabase Documentation](https://supabase.com/docs)
- [Next.js Documentation](https://nextjs.org/docs)

## 📝 License

This project is private and proprietary.
