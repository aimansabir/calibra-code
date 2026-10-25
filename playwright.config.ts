import { defineConfig, devices } from '@playwright/test';

const PORT = 4180;

// Runs against the production build served by the real server, with its own data folder.
export default defineConfig({
  testDir: 'e2e',
  timeout: 240000,
  expect: { timeout: 30000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npx tsx server/index.ts',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120000,
    env: { PORT: String(PORT), DATA_DIR: 'e2e/.data', STATIC_DIR: 'dist' },
  },
});
