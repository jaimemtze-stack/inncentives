#!/usr/bin/env node
// Orchestrates the browser tests: fresh database + seed, Playwright (which
// starts the API and the web dev server), then drops the database.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const api = new URL('../apps/api/', import.meta.url).pathname;
const web = new URL('../apps/web/', import.meta.url).pathname;
const run = (cmd, args, opts) => execFileSync(cmd, args, { encoding: 'utf8', ...opts });

const dbUrl = run('npx', ['tsx', 'src/scripts/e2e-db.ts', 'create'], { cwd: api }).trim();
const env = {
  ...process.env,
  NODE_ENV: 'development',
  LOG_LEVEL: 'warn',
  PORTAL_HOST: 'soporte.localhost:5173',
  AGENT_HOST: 'agentes.soporte.localhost:5173',
  PUBLIC_SCHEME: 'http',
  PWNED_PASSWORDS_CHECK: 'false',
  SECRETS_DIR: '/nonexistent',
  SECRET_DATABASE_URL: dbUrl,
  SECRET_REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:56379/14',
  SECRET_FIELD_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  SEED_PASSWORD: 'frase de prueba e2e 2026',
  // Shared secret of the "Reportar un problema" widget (e2e/widget.spec.ts signs with it).
  SECRET_INNCENTIVES_WIDGET_SECRET: randomBytes(32).toString('hex'),
};
let status = 1;
try {
  run('npx', ['tsx', 'src/scripts/seed.ts'], { cwd: api, env, stdio: 'inherit' });
  status =
    spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
      cwd: web,
      env,
      stdio: 'inherit',
    }).status ?? 1;
} finally {
  run('npx', ['tsx', 'src/scripts/e2e-db.ts', 'drop', dbUrl], { cwd: api });
}
process.exit(status);
