import { expect, test } from '@playwright/test';

test.describe('Security Hardening @feature:permissions', () => {
  test('E2E endpoint should reject requests without secret header', async ({ request }) => {
    const response = await request.post('/api/e2e/ensure-user', {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'dummy@example.com', password: 'dummy-password' },
    });

    expect(response.status()).toBe(404);
  });

  test('Mutation API should reject origin mismatch', async ({ request }) => {
    const response = await request.post('/api/boards', {
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example.com',
      },
      data: { name: 'origin-attack', description: 'attack' },
    });

    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body?.error?.code).toBe('INVALID_ORIGIN');
  });

  test('Google webhook should reject spoofed callback', async ({ request }) => {
    const response = await request.post('/api/integrations/google-calendar/webhook', {
      headers: {
        'x-goog-channel-id': 'spoofed-channel',
        'x-goog-channel-token': 'spoofed-token',
        'x-goog-resource-id': 'spoofed-resource',
        'x-goog-resource-state': 'exists',
      },
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body?.error).toBe('UNAUTHORIZED_WEBHOOK');
  });
});
