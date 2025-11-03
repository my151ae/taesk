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

    // 5. Inject Supabase session into localStorage and cookies
    // Extract project ref from Supabase URL
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    const storageKey = `sb-${projectRef}-auth-token`;

    // Store in localStorage (for backward compatibility)
    await page.evaluate(({ key, sessionData }) => {
      localStorage.setItem(key, JSON.stringify(sessionData));
      console.log('[Global Setup] Session stored in localStorage with key:', key);
    }, { key: storageKey, sessionData: session });

    // Store in cookies (required for @supabase/ssr)
    const domain = new URL(BASE_URL).hostname;
    const accessTokenCookie = {
      name: `sb-${projectRef}-auth-token`,
      value: JSON.stringify(session),
      domain: domain,
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
      expires: session.expires_at || Date.now() / 1000 + 3600,
    };

    await context.addCookies([accessTokenCookie]);
    console.log('[Global Setup] Session stored in cookies');

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

    // 7. Ensure MAIN_BOARD exists for tests
    console.log('[Global Setup] Ensuring MAIN_BOARD exists...');

    const MAIN_BOARD_ID = '00000000-0000-0000-0000-000000000001';
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Check if MAIN_BOARD exists
    const { data: existingBoard } = await supabaseAdmin
      .from('boards')
      .select('id')
      .eq('id', MAIN_BOARD_ID)
      .maybeSingle();

    if (!existingBoard) {
      // Create MAIN_BOARD with deterministic values
      const { error: insertError } = await supabaseAdmin
        .from('boards')
        .insert({
          id: MAIN_BOARD_ID,
          name: 'Main Board',
          short_id: 'MAINBOARD',
          id_short: '1',
          slug: 'main-board',
          user_id: loginResult.session.user.id,
        });

      if (insertError) {
        console.error('[Global Setup] Warning: Failed to create MAIN_BOARD:', insertError);
      } else {
        console.log('[Global Setup] ✅ MAIN_BOARD created');
      }
    } else {
      console.log('[Global Setup] ✅ MAIN_BOARD already exists');
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
