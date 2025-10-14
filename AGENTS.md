# Repository Guidelines

## Communication Rules
対話は常に日本語で回答してください。返信時に英語へ切り替えないよう徹底し、必要に応じて専門用語のみ英語を併記します。

## Project Structure & Module Organization
Keep UI routes under `app/`, grouped by feature folders so components stay close to their pages; core board logic lives in `app/page.tsx`. Shared utilities such as the Supabase client and board helpers belong in `lib/`. End-to-end specs and Playwright setup scripts sit in `e2e/`, with persistent auth state cached in `playwright/.auth/`. Place images and static assets in `public/`, generated documentation under `docs/`, and any new automation scripts inside `scripts/`. Review the docs in `/docs` (especially architecture and tickets) before tackling feature-level work.

## Build, Test, and Development Commands
Use `npm run dev` for the local Next.js server on port 3000. Create production bundles with `npm run build`, and serve them via `npm run start`. Run `npm run lint` to enforce import order, Tailwind usage, and strict TypeScript rules. Launch end-to-end automation with `npm run test:e2e`; add flags such as `--ui` or `--debug` for interactive runs after exporting `.env.test` credentials (`set -a && source .env.test && set +a`).

テスト結果だけ確認したい場合は `npx playwright test --reporter=json` を利用するとターミナルで完結して結果を取得できる。HTML レポートを開きたい場合は `npx playwright show-report --port=0` を推奨（または事前に `lsof -i :9323` で既存の show-report プロセスを停止してから実行）し、終了時は `Ctrl+C` でサーバーを明示的に止める。

## Coding Style & Naming Conventions
The repo follows strict TypeScript settings from `tsconfig.json`. Prefer explicit types on exported functions and keep indentation at two spaces. Use kebab-case for routes (`app/board-overview/page.tsx`), camelCase for variables and helpers, PascalCase for React components, and Tailwind utility classes for layout. Run `npm run lint` before sending changes to ensure consistent formatting.

## Testing Guidelines
Playwright (`@playwright/test`) powers end-to-end coverage; organize scenarios with `test.describe` blocks and name files after the feature (`e2e/board.spec.ts`). Reuse the seeded Supabase auth state from `e2e/.setup/auth-global-setup.ts` rather than bypassing login flows. Reset the cached session if failures suggest expired tokens (`rm playwright/.auth/user.json`), and verify with browser DevTools that pages render without console errors or failed network requests.

## Commit & Pull Request Guidelines
Write short, imperative commit messages (English or Japanese), mirroring existing history such as `Add card modal view`. Keep each commit focused on one fix or feature. Pull requests should describe user-facing impact, summarize key changes, attach relevant screenshots or Playwright traces for UI work, and link tickets from `docs/tickets/` when applicable. Never commit or push without explicit user approval.

## Security & Configuration Tips
Never commit real Supabase service-role keys; rely on `.env.test` copies for shared testing. Update `.env.example` whenever new variables are introduced and note authentication-sensitive changes in the global setup. Avoid destructive git commands unless explicitly requested, and leave unrelated worktree changes untouched.

## Workflow Reminders
Before starting, skim the relevant `/docs` material and check existing implementations for similar patterns. During development, keep the dev server running, test interactions in Chrome DevTools, and address console warnings promptly. Run the appropriate npm scripts before handing off work, and document notable deviations in the PR description.
