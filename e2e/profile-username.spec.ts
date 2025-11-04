import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const TEST_USER_ID = 'f6baf5d0-ac5b-491a-aa47-3bc5c05243f2'; // e2e.taesk.test@gmail.com
const TEST_USER_EMAIL = process.env.E2E_USER_EMAIL || 'e2e.taesk.test@gmail.com';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Supabase service role configuration is required for profile username tests');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const randomUsername = () => `e2euser${Math.random().toString(36).slice(2, 10)}`;

async function resetTestUserUsername() {
  await supabaseAdmin
    .from('profiles')
    .update({ username: null })
    .eq('id', TEST_USER_ID);
}

test.describe('Profile Username Management @feature:profile-username', () => {
  test.beforeEach(async () => {
    await resetTestUserUsername();
  });

  test.afterEach(async () => {
    await resetTestUserUsername();
  });

  test('check-username endpoint validates formats and reservations', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/b\//);

    const shortResponse = await page.request.get('/api/profiles/check-username?username=ab');
    expect(shortResponse.status()).toBe(200);
    expect(await shortResponse.json()).toMatchObject({ available: false, reason: 'invalid_format' });

    const reservedResponse = await page.request.get('/api/profiles/check-username?username=admin');
    expect(reservedResponse.status()).toBe(200);
    expect(await reservedResponse.json()).toMatchObject({ available: false, reason: 'reserved' });

    const candidate = randomUsername();
    const availableResponse = await page.request.get(`/api/profiles/check-username?username=${candidate}`);
    expect(availableResponse.status()).toBe(200);
    const availableBody = await availableResponse.json();
    expect(availableBody.available).toBeTruthy();
    expect(availableBody.username).toBe(candidate);
  });

  test('PATCH /api/profiles updates username and normalizes case', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/b\//);

    const desired = `Test${randomUsername()}`;
    const response = await page.request.patch('/api/profiles', {
      data: {
        username: desired,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.username).toBe(desired.toLowerCase());

    const { data: profileRecord } = await supabaseAdmin
      .from('profiles')
      .select('username')
      .eq('id', TEST_USER_ID)
      .maybeSingle();

    expect(profileRecord?.username).toBe(desired.toLowerCase());
  });

  test('UI surfaces @username after update', async ({ page }) => {
    const username = randomUsername();

    await page.goto('/');
    await page.waitForURL(/\/b\//);

    const patchResponse = await page.request.patch('/api/profiles', {
      data: {
        username,
      },
    });
    expect(patchResponse.status()).toBe(200);

    await page.reload();

    const profileButton = page.getByTestId('user-display-name');
    await expect(profileButton).toHaveText(new RegExp(`@${username}`, 'i'));

    const shareButton = page.getByRole('button', { name: /share/i });
    await shareButton.click();
    await expect(page.getByText('メンバーを追加')).toBeVisible();

    await expect(page.getByText(new RegExp(`@${username}`, 'i')).first()).toBeVisible();
  });
});
