import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: '.env.test' });

const isCI = !!process.env.CI;
const workers = process.env.PW_WORKERS
  ? Number(process.env.PW_WORKERS)
  : (isCI ? 2 : '50%'); // CI: 2 workers (競合低減), Local: 50% (速度重視)
const defaultJsonOutput = path.join('test-results', 'playwright-report.json');

const resolveJsonOutput = (value?: string) => {
  if (!value) return defaultJsonOutput;
  if (path.isAbsolute(value)) return value;
  if (value.includes('/') || value.includes('\\')) {
    return value;
  }
  return path.join('test-results', value);
};

const jsonOutput = resolveJsonOutput(process.env.PLAYWRIGHT_JSON_OUTPUT_NAME);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: !isCI,
  forbidOnly: !!process.env.CI,
  retries: isCI ? 2 : 1, // Local でも1回リトライ (flake耐性)
  workers,
  timeout: 90_000, // テストタイムアウトを90秒に延長
  expect: { timeout: 10_000 }, // expect タイムアウトを10秒に延長
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
