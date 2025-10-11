# Repository Guidelines

## Project Structure & Module Organization
The Next.js app lives under `app/` with route groups split by feature; shared utilities (Supabase client, board helpers) sit in `lib/`. End-to-end specs and setup scripts are under `e2e/`, while Playwright state is stored in `playwright/.auth/`. Assets and static files belong in `public/`, and generated docs live in `docs/`. Keep new scripts in `scripts/` so they remain discoverable.

## Build, Test, and Development Commands
Use `npm run dev` to launch the local dev server on port 3000. `npm run build` produces the production bundle, and `npm run start` serves the built output. `npm run lint` runs Next.js ESLint rules. Run UI automation with `npm run test:e2e`; add `--ui` or `--debug` for interactive modes. Before running tests, export `.env.test` (e.g. ``set -a && source .env.test && set +a``) so Supabase credentials are available.

## Coding Style & Naming Conventions
Follow TypeScript strictness from `tsconfig.json`; prefer explicit types on exported functions. Use 2-space indentation, kebab-case for routes, camelCase for functions and variables, and PascalCase for React components. Keep React files co-located with their route or feature folder. Run `npm run lint` prior to commits to enforce formatting and import order.

## Testing Guidelines
Playwright (`@playwright/test`) drives E2E coverage; place new specs under `e2e/` and group them with `test.describe`. Name files with the feature they cover (e.g. `board.spec.ts`). Tests rely on Supabase auth state created by `e2e/.setup/auth-global-setup.ts`; avoid bypassing it unless you update the global setup. Commit new recordings or reports inside `playwright-report/` only when they illustrate a failure being investigated.

## Commit & Pull Request Guidelines
Existing history favors short, imperative summaries (Japanese or English), e.g. `Add card modal view`. Scope commits narrowly around a single feature or fix. PRs should describe the user-facing impact, list key changes, and note any follow-up tasks. Attach screenshots or Playwright traces when touching UI flows, and reference ticket IDs from `docs/tickets/` when applicable.

## Security & Configuration Tips
Never check real Supabase service role keys into `.env.local`; rely on `.env.test` copies for shared testing. Reset the cached Playwright auth state via `rm playwright/.auth/user.json` if tests fail due to expired sessions. When adding environment variables, document them in `.env.example` and update the global setup if they affect authentication.
