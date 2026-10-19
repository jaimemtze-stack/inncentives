import { defineConfig, devices } from '@playwright/test';

// Run through `pnpm test:e2e` at the repository root (scripts/e2e.mjs), which
// prepares a fresh database and the environment used below.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    locale: 'es-MX',
    ...devices['Desktop Chrome'],
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  webServer: [
    {
      command: 'pnpm --filter @mesa/api run build && pnpm --filter @mesa/api start',
      timeout: 120_000,
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'pnpm --filter @mesa/web exec vite --host 127.0.0.1',
      url: 'http://127.0.0.1:5173/',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
