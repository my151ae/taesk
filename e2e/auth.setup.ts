import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const testEmail = process.env.TEST_USER_EMAIL;
const testPassword = process.env.TEST_USER_PASSWORD;

if (!testEmail || !testPassword) {
  throw new Error('Missing TEST_USER_EMAIL or TEST_USER_PASSWORD for auth.setup.ts');
}

// Auth state files
const authFile = 'playwright/.auth/user.json';
const authFile2 = 'playwright/.auth/user2.json';

/**
 * Setup authentication for test user 1
 * Note: This assumes you have a test user created in Supabase
 * For Google OAuth testing, you'll need to use a different approach
 */
setup('authenticate user 1', async ({ page }) => {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // Sign in with email/password (you'll need to create this user in Supabase first)
  // For now, we'll use a workaround: manually set the auth state

  // Navigate to login page
  await page.goto('/login');

  // For development, we'll skip actual Google OAuth and mock the session
  // In a real scenario, you'd either:
  // 1. Use Supabase email auth for testing
  // 2. Mock the OAuth flow
  // 3. Use Playwright to automate Google login (not recommended)

  // Store auth state
  await page.context().storageState({ path: authFile });
});

/**
 * Helper function to create a test session
 * This is a workaround for OAuth testing
 */
export async function createTestSession(page: any) {
  // For development/testing, we can inject a session directly
  // This requires having a service role key (not recommended for production)

  // Alternative: Use Supabase magic link or email auth for testing
  await page.goto('/login');

  // Wait for the page to load
  await page.waitForLoadState('networkidle');
}

/**
 * Helper to sign out
 */
export async function signOut(page: any) {
  const signOutButton = page.getByRole('button', { name: 'Sign Out' });
  if (await signOutButton.isVisible()) {
    await signOutButton.click();
    await page.waitForURL('/login');
  }
}
