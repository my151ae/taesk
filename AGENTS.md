# Repository Guidelines

> **最優先ルール（テスト実行）**
> - `npx playwright test --reporter=json` で **必ず JSON 出力に保存**し、そのファイルを解析すること。
> - `NODE_ENV=test npm run dev` などのサーバー起動・手動検証コマンド、Playwright 実行時に JSON を出さない手法は **全面禁止**。どうしても必要な場合はユーザー許可を得ること。
> - テスト結果を確認せずに止まらないよう、必ず JSON ファイルを生成・確認し、失敗時は解析用スクリプト（例: `python - ... json.loads`）で詳細を抽出する。
> - 上記に違反するコマンドや手順は今後一切行わないこと。
> - `npx playwright test --reporter=list` は CLI がフリーズして結果取得できなくなるため **禁止**（JSON レポートのみ使用）。

## Communication Rules
対話は常に日本語で回答してください。返信時に英語へ切り替えないよう徹底し、必要に応じて専門用語のみ英語を併記します。

## Project Structure & Module Organization
Keep UI routes under `app/`, grouped by feature folders so components stay close to their pages. The canonical board experience lives in `app/(board)/`:
- `app/(board)/_components/KanbanBoardClient.tsx` contains nearly all board logic (lists, cards, realtime sync, offline queue).
- `app/(board)/@modal/(...)c/[short_id]/[[...slug]]/page.tsx` wires the intercepting modal flow, rendering `app/components/CardModal.tsx` for editing.
- `app/(board)/b/[short_id]/[[...slug]]/page.tsx` resolves canonical board URLs and hydrates data.

Shared utilities such as the Supabase client, board/card helpers, and sync queue live under `lib/`. API routes for lists/cards/boards are colocated at `app/api/boards/...` and should be preferred over direct Supabase usage inside client components. End-to-end specs and Playwright setup scripts sit in `e2e/`, with persistent auth state cached in `playwright/.auth/`. Place images and static assets in `public/`, generated documentation under `docs/`, and any new automation scripts inside `scripts/`. Review the docs in `/docs` (especially architecture and tickets) before tackling feature-level work.

### Recent Architectural Notes
- Cards now carry `assignee_id` (linked to `profiles`) with a legacy `assigned_to` text fallback; server/API code must upsert both to keep backwards compatibility.
- Short URLs for cards and boards rely on `short_id`, `id_short`, and `slug`; ensure these fields travel through sync endpoints when creating or reordering records.
- Offline sync queues should continue to flow through the API routes so server-side activity logging and permissions remain consistent.

## Build, Test, and Development Commands
Use `npm run dev` for the local Next.js server on port 3000. Create production bundles with `npm run build`, and serve them via `npm run start`. Run `npm run lint` to enforce import order, Tailwind usage, and strict TypeScript rules. Launch end-to-end automation with `npm run test:e2e`; add flags such as `--ui` or `--debug` for interactive runs after exporting `.env.test` credentials (`set -a && source .env.test && set +a`).

テスト結果だけ確認したい場合は `npx playwright test --reporter=json` を利用するとターミナルで完結して結果を取得できる。HTML レポートを開きたい場合は `npx playwright show-report --port=0` を推奨（または事前に `lsof -i :9323` で既存の show-report プロセスを停止してから実行）し、終了時は `Ctrl+C` でサーバーを明示的に止める。

## Coding Style & Naming Conventions
The repo follows strict TypeScript settings from `tsconfig.json`. Prefer explicit types on exported functions and keep indentation at two spaces. Use kebab-case for routes (`app/board-overview/page.tsx`), camelCase for variables and helpers, PascalCase for React components, and Tailwind utility classes for layout. Run `npm run lint` before sending changes to ensure consistent formatting.

## Testing Guidelines
- Playwright (`@playwright/test`) で E2E を実行する際は、`npx playwright test --reporter=json > playwright-report.json` を必須コマンドとして使用し、常に JSON レポートを生成する。`.env.test` は `playwright.config.ts` が自動で読み込むため追加の `set -a` は不要。
- 生成されたレポートは `cat playwright-report.json | jq '.stats'` で確認する。ファイル冒頭にセットアップのログが付く場合は `sed -n '/^{/,$p' playwright-report.json | jq '.stats'` として JSON 部分だけを jq に渡すこと。
- `jq` が利用できない環境では `tail -20 playwright-report.json | grep -E '"(expected|unexpected|skipped|flaky)"'` を用いて件数を抽出し、成功/失敗を明示する。
- グローバルセットアップが Supabase 認証情報を `playwright/.auth/user.json` に保存するため、バイパスせず必ずこれを利用する。トークン失効時はファイルを削除して再実行する。
- `e2e/` の各 spec はテスト用ボードを作成して `afterEach` で削除する設計なので、シナリオ追加時もデータ分離を徹底する。ドラッグ&ドロップなど時間が掛かる操作は既存ヘルパー (`dragAndDrop` など) を活用し、`waitForURL` や適切な待機を入れて安定化させる。

## Commit & Pull Request Guidelines
Write short, imperative commit messages (English or Japanese), mirroring existing history such as `Add card modal view`. Keep each commit focused on one fix or feature. Pull requests should describe user-facing impact, summarize key changes, attach relevant screenshots or Playwright traces for UI work, and link tickets from `docs/tickets/` when applicable. Never commit or push without explicit user approval.

## Security & Configuration Tips
Never commit real Supabase service-role keys; rely on `.env.test` copies for shared testing. Update `.env.example` whenever new variables are introduced and note authentication-sensitive changes in the global setup. Avoid destructive git commands unless explicitly requested, and leave unrelated worktree changes untouched.

## Workflow Reminders
Before starting, skim the relevant `/docs` material and check existing implementations for similar patterns. During development, keep the dev server running, test interactions in Chrome DevTools, and address console warnings promptly. Run the appropriate npm scripts before handing off work, and document notable deviations in the PR description.
