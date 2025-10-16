import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load .env.test before running tests
dotenv.config({ path: '.env.test' });

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Phase 1: Sequential execution in CI for stability
  workers: process.env.CI ? 1 : 4,
  reporter: 'html',

  // Global setup for authentication
  globalSetup: require.resolve('./e2e/.setup/auth-global-setup'),

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // Use authenticated state by default (created by globalSetup)
    storageState: 'playwright/.auth/user.json',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // Removed NEXT_PUBLIC_BYPASS_AUTH - now using real authentication
    command: 'NODE_ENV=test npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
