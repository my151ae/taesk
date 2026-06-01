# Taesk

Taesk is a team task and timeline app built with Next.js and Supabase. It focuses on board-based planning with Timeline, List, and Month views, team and board permissions, comments, mentions, notifications, Web Push, Google Calendar sync, and Playwright E2E coverage.

## Features

- Timeline, List, and Month board views
- Team and board permissions backed by Supabase
- Card comments, mentions, child cards, history, and trash restore
- Notifications, daily digests, and Web Push support
- Google Calendar OAuth, watch, and sync flows
- Playwright E2E and focused unit-style browser tests

## Screenshots

Screenshots will be added under `docs/assets/` before a public launch announcement.

## Local Development

1. Install dependencies.

```bash
npm ci
```

2. Create local environment files from the examples.

```bash
cp .env.example .env.local
cp .env.test.example .env.test
```

3. Create a Supabase project, apply migrations from `supabase/migrations/`, and fill in your local Supabase URL, anon key, and service role key.

4. Start the development server.

```bash
npm run dev
```

## Testing

```bash
npm run lint
npm test
npm run build
PW_WORKERS=1 npx playwright test e2e/timeline.spec.ts --list
PW_WORKERS=1 npx playwright test e2e/timeline.spec.ts -g "card|modal|peek" --reporter=json
```

E2E endpoints require `E2E_ENABLED=true`, a matching `E2E_SECRET`, and a non-production environment. They are intended for local/test use only.

## Security

Never commit real `.env` files or service credentials. `SUPABASE_SERVICE_ROLE_KEY` is server-only and must not be imported into client components. See `SECURITY.md` and `docs/security.md` before changing RLS, permissions, E2E APIs, or integration secrets.

## Roadmap

- Public CI hardening
- Release automation
- Supabase RLS and permission review
- Google Calendar sync reliability
- Broader E2E coverage

## License

MIT
