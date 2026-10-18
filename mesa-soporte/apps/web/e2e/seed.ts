/**
 * Password of the demo users: scripts/e2e.mjs seeds a fresh database with
 * SEED_PASSWORD and passes the same environment to Playwright.
 */
export const PASSWORD: string = (() => {
  const p = process.env.SEED_PASSWORD;
  if (!p) throw new Error('Run the E2E tests with `pnpm test:e2e` (SEED_PASSWORD is not set)');
  return p;
})();
