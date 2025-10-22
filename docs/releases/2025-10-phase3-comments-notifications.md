# Release Notes – October 2025: Comments & Notifications

## Highlights

- Web Push delivery is now functional end-to-end.
- Notification preferences modal lets users toggle in-app alerts, manage push subscriptions, and configure quiet hours.
- Edge Function implements VAPID-authenticated push sends with delivery logging and rate limiting.
- Added Playwright coverage (`phase3-webpush.spec.ts`) to exercise the modal, quiet hours, and test button.

## Setup Checklist

1. Generate VAPID keys (`npx web-push generate-vapid-keys`).
2. Update Supabase secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
3. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in the deployment environment.
4. Run migrations up to `20251022000004_notification_preferences.sql`.

## Known Issues

- Quiet hours currently skip notifications instead of rescheduling them.
- Push mocks are used in Playwright; real deliveries should be verified manually against the Supabase logs.
- iOS Safari still requires manual testing – the feature is disabled by capability detection.

## Links

- Feature docs: `docs/detail/notifications.md`
- Local setup: `docs/setup/local-dev.md`
- Tickets: `docs/tickets/2025-10-22/0302-*`, `0303-*`, `0304-*`
