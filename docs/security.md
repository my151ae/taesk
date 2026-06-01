# Security Notes

Taesk uses Supabase for authentication, data storage, permissions, realtime updates, and service-role maintenance operations. Public repository hygiene depends on keeping project-specific credentials out of source control.

## Environment Files

Use `.env.example` and `.env.test.example` as templates only. Real `.env` files must stay local and ignored by git.

## Supabase Service Role

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and is only for server-side code, local E2E setup, and maintenance scripts. Client components must use the anon key through the normal Supabase browser client.

## E2E Endpoints

Routes under `/api/e2e/*` require `E2E_ENABLED=true`, a matching `x-e2e-secret` header, and a non-production environment. Missing or incorrect configuration must fail closed.

## Publication Requirements

Before public release, remove any committed environment files from current history, rotate exposed credentials, and verify that no real project URL, anon key, service role key, OAuth secret, VAPID private key, KV token, or test password remains in tracked files.
