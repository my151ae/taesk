import { chromium, FullConfig } from '@playwright/test';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load .env.test file manually
const envPath = path.join(__dirname, '../../.env.test');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
}

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const E2E_SECRET = process.env.E2E_SECRET || 'redacted-e2e-secret';

const TEST_USER = {
  email: process.env.E2E_USER_EMAIL || 'e2e-test@taesk.app',
  password: process.env.E2E_USER_PASSWORD || 'replace-with-local-test-password',
};

const AUTH_FILE = path.join(__dirname, '../../playwright/.auth/user.json');

/**
 * Global Setup for E2E Tests
 *
 * This runs once before all tests to:
 * 1. Ensure test user exists
 * 2. Sign in and capture session
 * 3. Save storageState for all tests to reuse
 */
export default async function globalSetup(config: FullConfig) {
  console.log('[Global Setup] Starting authentication setup...');

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Ensure test user exists
    console.log(`[Global Setup] Ensuring test user exists: ${TEST_USER.email}`);

    const ensureUserResponse = await page.request.post(`${BASE_URL}/api/e2e/ensure-user`, {
      headers: {
        'Content-Type': 'application/json',
        'x-e2e-secret': E2E_SECRET,
      },
      data: TEST_USER,
    });

    if (!ensureUserResponse.ok()) {
      const error = await ensureUserResponse.text();
      throw new Error(`Failed to ensure user (${ensureUserResponse.status()}): ${error}`);
    }

    const ensureResult = await ensureUserResponse.json();
    console.log('[Global Setup] User status:', ensureResult.created ? 'created' : 'already exists');

    // 2. Sign in programmatically
    console.log('[Global Setup] Signing in...');

    const loginResponse = await page.request.post(`${BASE_URL}/api/e2e/login-as`, {
      headers: {
        'Content-Type': 'application/json',
        'x-e2e-secret': E2E_SECRET,
      },
      data: TEST_USER,
    });

    if (!loginResponse.ok()) {
      const error = await loginResponse.text();
      throw new Error(`Failed to sign in (${loginResponse.status()}): ${error}`);
    }

    const loginResult = await loginResponse.json();
    console.log('[Global Setup] Sign-in successful:', loginResult.session.user.email);

    const session = loginResult.session;

    // 4. Navigate to app to establish session in browser context
    await page.goto(BASE_URL);

    // 5. Inject Supabase session into localStorage
    // Extract project ref from Supabase URL
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    const storageKey = `sb-${projectRef}-auth-token`;

    await page.evaluate(({ key, sessionData }) => {
      localStorage.setItem(key, JSON.stringify(sessionData));
      console.log('[Global Setup] Session stored in localStorage with key:', key);
    }, { key: storageKey, sessionData: session });

    // 5. Save storage state
    await context.storageState({ path: AUTH_FILE });
    console.log(`[Global Setup] Storage state saved to: ${AUTH_FILE}`);

    // 6. Verify authentication works
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Check if we're authenticated (should not redirect to login)
    const url = page.url();
    if (url.includes('/login')) {
      throw new Error('Authentication failed - redirected to login page');
    }

    console.log('[Global Setup] ✅ Authentication setup complete');
  } catch (error) {
    console.error('[Global Setup] ❌ Setup failed:', error);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}
