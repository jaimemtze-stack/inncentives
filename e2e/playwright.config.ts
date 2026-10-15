import { defineConfig } from '@playwright/test';

/**
 * Browser E2E against a running stack (docker compose --profile app, or `pnpm dev`).
 * Requires freshly seeded demo data (SEED_DEMO_PASSWORD) because flows enroll MFA.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_PORTAL_URL ?? 'http://localhost:5173',
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
    trace: 'retain-on-failure',
  },
});
