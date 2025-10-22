# Notifications Overview

This document describes how Taesk creates, stores, and delivers notifications across the product.

## Notification Types

- **In-app notifications** – persisted in the `notifications` table and surfaced inside the UI.
- **Web Push notifications** – delivered through the browser when users opt in.

Both channels share the same creation pipeline but respect user preferences individually.

## Data Flow

1. **Event triggers** (e.g., a comment or mention) call `createNotification` in `lib/server/notifications.ts`.
2. The helper reads `notification_preferences` for the recipient:
   - `in_app_enabled` – skip notification entirely when `false`.
   - `quiet_hours` – suppress notifications during the configured window.
3. A dedupe key prevents duplicate rows for the same event.
4. Successful inserts into `notifications` fire the Supabase trigger defined in `20251022000001_notification_push_trigger.sql`.
5. The trigger invokes the Edge Function `supabase/functions/send-push-notification/index.ts` which:
   - Loads preferences again to honour `web_push_enabled` and quiet hours.
   - Applies a per-subscription rate limit (default 10 per minute).
   - Logs delivery attempts in `notification_delivery_logs`.
   - Removes failing subscriptions after repeated errors.

## Notification Preferences

The `notification_preferences` table stores per-user settings:

| Column | Type | Notes |
| --- | --- | --- |
| `profile_id` | UUID PK | matches `profiles.id` |
| `in_app_enabled` | boolean (default `true`) | disable all in-app notifications |
| `web_push_enabled` | boolean (default `false`) | whether push delivery is allowed |
| `quiet_hours` | JSONB or `null` | `{ "start": "HH:mm", "end": "HH:mm", "timezone": "IANA" }` |
| `created_at` / `updated_at` | timestamptz | maintained by trigger |

API routes:

- `GET /api/notifications/preferences` – returns the current preferences (defaults when no row exists).
- `PUT /api/notifications/preferences` – accepts partial updates (`in_app_enabled`, `web_push_enabled`, `quiet_hours`).
- `POST /api/notifications/test` – enqueues a test notification for the authenticated user.

Clients should treat the API as the source of truth instead of talking to Supabase directly.

## Web Push Behaviour

The Edge Function uses the [`web-push`](https://www.npmjs.com/package/web-push) library inside Deno. Environment variables required at deployment time:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

When keys are missing the function exits early and no push is attempted (delivery log records the skip).

### Delivery Logs

`notification_delivery_logs` keeps a history for observability and rate limiting. Columns include `status` (`success`, `failure`, `retrying`), the associated notification, the subscription, and optional error text.

## Quiet Hours Logic

- Quiet hours compares the current time in the user’s timezone against the configured window.
- Overnight ranges (e.g., 22:00 → 07:00) are supported by wrapping across midnight.
- Quiet hours apply to both in-app creation (notifications can be skipped completely) and push delivery. Currently skipped notifications are not requeued.

## Related Components

- **UI:** `app/(board)/_components/NotificationSettings.tsx`
- **Server helpers:** `lib/server/notifications.ts`
- **Edge Function:** `supabase/functions/send-push-notification/index.ts`
- **Playwright E2E:** `e2e/phase3-webpush.spec.ts`

Refer to `docs/setup/local-dev.md` for local testing instructions and environment setup.
