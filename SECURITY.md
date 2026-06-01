# Security Policy

## Supported Versions

The `main` branch is the only supported development line before the first public release.

## Reporting a Vulnerability

Do not disclose vulnerabilities, credentials, tokens, or private project details in public issues. Contact the maintainer privately and include only the minimum information needed to reproduce the issue.

## Secret Handling

- Never commit `.env`, `.env.*`, service role keys, OAuth secrets, VAPID private keys, KV tokens, or test passwords.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. It must not be exposed through `NEXT_PUBLIC_` variables or client bundles.
- E2E endpoints under `/api/e2e/*` are for local/test use only and must remain disabled in production.
- PRs that change Supabase RLS, permissions, invite flows, E2E APIs, or integration authentication must include focused tests.

## Rotation Guidance

If any secret may have been committed or logged, rotate it in the owning service, remove it from the repository and history, and verify with a fresh secret scan before making the repo public.
