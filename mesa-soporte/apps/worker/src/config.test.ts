import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkerConfig } from './config';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

function secretsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'worker-secrets-'));
  writeFileSync(join(dir, 'redis_url'), 'redis://localhost:6379/0', { mode: 0o600 });
  return dir;
}

describe('loadWorkerConfig', () => {
  it('treats empty optional variables from docker compose as unset', () => {
    process.env = {
      ...saved,
      NODE_ENV: 'production',
      SECRETS_DIR: secretsDir(),
      MAIL_TRANSPORT: 'smtp',
      GRAPH_TENANT_ID: '',
      GRAPH_CLIENT_ID: '',
      GRAPH_SENDER: '',
    };
    const cfg = loadWorkerConfig();
    expect(cfg.GRAPH_SENDER).toBeUndefined();
    expect(cfg.MAIL_TRANSPORT).toBe('smtp');
  });

  it('still rejects an invalid sender', () => {
    process.env = { ...saved, SECRETS_DIR: secretsDir(), GRAPH_SENDER: 'not-an-email' };
    expect(() => loadWorkerConfig()).toThrow();
  });
});
