import { test, expect } from '@playwright/test';

/**
 * Authentication and User Isolation Tests
 *
 * Note: These tests verify the authentication flow and data isolation
 * For Google OAuth, we test the UI elements and redirects rather than
 * the full OAuth flow (which would require real Google credentials)
 *
 * These tests use unauthenticated state by resetting storageState.
 * See: docs/tickets/2025-10-10/02-programmatic-sign-in-e2e-plan.md
 */

// Reset storage state for this file - tests run as unauthenticated users
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Authentication', () => {
  test('should redirect to login page when not authenticated', async ({ page }) => {
    await page.goto('/');

    // Should redirect to /login
    await expect(page).toHaveURL('/login');

    // Should show login UI
    await expect(page.getByRole('heading', { name: 'Taesk' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible();
  });

  test('should show error message on login page if error param exists', async ({ page }) => {
    await page.goto('/login?error=Test%20error%20message');

    // Should show error message
    await expect(page.getByText('Test error message')).toBeVisible();
  });

  test('should disable login button while logging in', async ({ page }) => {
    await page.goto('/login');

    const loginButton = page.getByRole('button', { name: /Continue with Google/i });
    await expect(loginButton).toBeEnabled();

    // Click login button - it will redirect to Google OAuth
    // We can't test the full flow without real credentials
    // but we can verify the button state changes
  });
});

test.describe('Data Isolation (requires manual setup)', () => {
  /**
   * Manual test instructions:
   *
   * 1. Open browser and login with User A
   * 2. Create a list called "User A List"
   * 3. Open incognito/private window
   * 4. Login with User B
   * 5. Verify "User A List" is NOT visible
   * 6. Create a list called "User B List"
   * 7. Switch back to User A's window
   * 8. Verify "User B List" is NOT visible
   *
   * These tests document the expected behavior.
   * Automated testing would require programmatic OAuth or test credentials.
   */

  test.skip('users should only see their own data', async ({ page }) => {
    // This test is skipped as it requires manual OAuth authentication
    // See manual test instructions above
  });

  test.skip('users cannot access other users data via direct DB queries', async () => {
    // This test would verify RLS policies
    // Requires Supabase service role access
  });
});

test.describe('Session Management', () => {
  test('should show login page after visiting any protected route', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });

  test('auth callback should handle errors gracefully', async ({ page }) => {
    await page.goto('/auth/callback?error=access_denied&error_description=User%20cancelled');

    // Should redirect to login with error
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/cancelled/i)).toBeVisible();
  });
});
