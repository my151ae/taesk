# Contributing

Thanks for helping improve Taesk.

## Workflow

- Open an issue for bugs, feature requests, or larger design changes.
- Use short branch names such as `fix/card-modal-focus` or `feat/calendar-retry`.
- Keep changes scoped and include tests for behavior changes.
- Do not include real secrets, local `.env` files, personal credentials, production URLs, or private project IDs.

## Local Checks

```bash
npm ci
npm run lint
npm test
npm run build
```

Run Playwright with `PW_WORKERS=1` and JSON reporting when investigating E2E behavior.

## Pull Request Checklist

- The PR explains the user-visible change or internal risk reduced.
- Relevant lint, tests, or build checks were run.
- Supabase schema changes include a migration.
- RLS, permissions, E2E APIs, and integration changes include focused tests.
- No secrets or real environment files are committed.

## Security Issues

Do not file public issues for vulnerabilities or leaked credentials. Follow `SECURITY.md`.
