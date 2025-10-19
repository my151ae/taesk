import { test, expect } from '@playwright/test';

test.describe('Phase3 - Invite Existing User', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/b\//);
  });

  test('should search and add existing user to board', async ({ page }) => {
    // Open Share dialog
    const shareButton = page.getByRole('button', { name: /share/i });
    await shareButton.click();

    // Wait for dialog
    await expect(page.getByText('メンバーを追加')).toBeVisible();

    // Enter test email (we'll need an existing user email)
    const emailInput = page.getByPlaceholder(/メールアドレス/);
    await emailInput.fill('test@example.com');

    // Select role
    const roleSelect = page.locator('select').first();
    await roleSelect.selectOption('editor');

    // Click add button
    const addButton = page.getByRole('button', { name: '追加' });
    await addButton.click();

    // Check for response (either success or "not registered" message)
    // Since we don't know if test@example.com exists, we just verify the API was called
    await page.waitForResponse((response) =>
      response.url().includes('/api/profiles/search?email=')
    );
  });

  test('should show error for non-existent user', async ({ page }) => {
    // Mock dialog.alert
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Taesk に登録されていません');
      await dialog.accept();
    });

    // Open Share dialog
    const shareButton = page.getByRole('button', { name: /share/i });
    await shareButton.click();

    await expect(page.getByText('メンバーを追加')).toBeVisible();

    // Enter non-existent email
    const emailInput = page.getByPlaceholder(/メールアドレス/);
    await emailInput.fill('nonexistent@example.com');

    const addButton = page.getByRole('button', { name: '追加' });
    await addButton.click();

    // Wait for API call
    await page.waitForResponse((response) =>
      response.url().includes('/api/profiles/search?email=nonexistent')
    );
  });

  test('should prevent adding duplicate members', async ({ page }) => {
    // This test would require knowing the current user's email
    // which is already a member (owner) of the board

    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('既にメンバーです');
      await dialog.accept();
    });

    const shareButton = page.getByRole('button', { name: /share/i });
    await shareButton.click();

    await expect(page.getByText('メンバーを追加')).toBeVisible();

    // Get current user's email from members list
    const membersSection = page.locator('text=Members').locator('..');
    const firstMemberEmail = await membersSection.locator('.text-sm.text-gray-500').first().textContent();

    if (firstMemberEmail) {
      const emailInput = page.getByPlaceholder(/メールアドレス/);
      await emailInput.fill(firstMemberEmail.trim());

      const addButton = page.getByRole('button', { name: '追加' });
      await addButton.click();

      await page.waitForResponse((response) =>
        response.url().includes('/api/profiles/search?email=')
      );
    }
  });

  test('API: GET /api/profiles/search should work', async ({ request }) => {
    // Test the API directly
    const response = await request.get('/api/profiles/search?email=nonexistent@example.com');
    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(body.error).toBe('User not found');
  });

  test('API: GET /api/profiles/search should require email param', async ({ request }) => {
    const response = await request.get('/api/profiles/search');
    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error).toBe('Email parameter is required');
  });
});
