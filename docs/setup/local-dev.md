# Local Development – Notifications & Web Push

This guide covers the extra steps required to exercise the notification system while running the app locally.

## Prerequisites

- Node.js (see project README for version)
- Supabase credentials (see `.env.test` for shared test values)
- [web-push CLI](https://www.npmjs.com/package/web-push) – installed automatically through `npx`

## 1. Generate VAPID Keys

```bash
npx web-push generate-vapid-keys
```

Take the generated `publicKey` and `privateKey` values.

## 2. Configure Environment Variables

Update `.env.local` (or export them in the shell) with:

```bash
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<publicKey>
VAPID_PRIVATE_KEY=<privateKey>
VAPID_SUBJECT=mailto:your-email@example.com
```

Restart `npm run dev` after changing the file.

## 3. Start the Development Server

```bash
npm install
npm run dev
```

The service worker at `/sw.js` registers automatically on the dashboard.

## 4. Enable Push Notifications

1. Sign in using test credentials (`e2e.taesk.test@gmail.com`).
2. Click the gear icon next to the notification bell.
3. Click **Enable** under “Browser Notifications”.
4. Allow the browser permission prompt.

The UI will persist a record in `notification_preferences` and store the subscription through `/api/push-subscriptions`.

## 5. Test Delivery

- Use the **Send Test Notification** button in the modal. A row is inserted into `notifications`, triggering the edge function.
- Check the browser console for mocked push logs or inspect `notification_delivery_logs` in Supabase.

## 6. Troubleshooting

| Symptom | Resolution |
| --- | --- |
| “VAPID keys not configured” appears in logs | Verify the env variables and redeploy/restart the edge function. |
| Push toggle reports success but no push arrives | Ensure the browser supports push, check for quiet hours, and verify the subscription exists in `push_subscriptions`. |
| Quiet hours never activate | Confirm the timezone is correct and start/end times are valid `HH:mm`. |

For more information, read `docs/detail/notifications.md` and the ticket specs under `docs/tickets/2025-10-22`.
