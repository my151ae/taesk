# Architecture

Taesk is a Next.js App Router application backed by Supabase.

## Application Layers

- `app/` contains routes, API handlers, board screens, and UI components.
- `lib/` contains shared domain logic, Supabase clients, calendar sync services, notifications, and server helpers.
- `supabase/migrations/` contains database schema, RLS, permissions, notification, calendar, and invite migrations.
- `e2e/` contains Playwright tests and helpers.
- `docs/spec/` contains the detailed product and implementation specifications.

## Core Domains

- Boards, cards, buckets, Timeline/List/Month navigation
- Teams, board members, invites, and permission checks
- Comments, mentions, notifications, and daily digests
- Google Calendar accounts, sync states, watch channels, and webhook handling
- E2E-only user/session helpers guarded by local/test-only controls

See `docs/index.md` for the canonical documentation index.
