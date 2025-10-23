import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const isCI = !!process.env.CI;
const workers = process.env.PW_WORKERS
  ? Number(process.env.PW_WORKERS)
  : (isCI ? 1 : undefined);
const jsonOutput = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? 'playwright-report.json';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: !isCI,
  forbidOnly: !!process.env.CI,
  retries: isCI ? 2 : 0,
  workers,
  outputDir: 'test-results',
  reporter: isCI
    ? [['json', { outputFile: jsonOutput }]]
    : [['list'], ['json', { outputFile: jsonOutput }], ['html', { open: 'never' }]],
  globalSetup: require.resolve('./e2e/.setup/auth-global-setup'),
  use: {
    baseURL: 'http://localhost:3000',
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    storageState: 'playwright/.auth/user.json',
  },
  projects: [
    {
      name: 'core',
      grepInvert: /@phase3|@wip/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'full',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'NODE_ENV=test npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !isCI,
  },
});
