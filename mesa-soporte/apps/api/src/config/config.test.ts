import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseFieldKeys } from './config';
import { FileSecretsProvider } from './secrets';

const key = Buffer.alloc(32, 7).toString('base64');
const base = {
  PORTAL_HOST: 'soporte.example.mx',
  AGENT_HOST: 'agentes.soporte.example.mx',
  SECRETS_DIR: '/nonexistent',
};

describe('config', () => {
  it('reads secrets from env only outside production', () => {
    const cfg = loadConfig({
      ...base,
      NODE_ENV: 'test',
      SECRET_DATABASE_URL: 'postgres://x',
      SECRET_REDIS_URL: 'redis://x',
      SECRET_FIELD_ENCRYPTION_KEYS: `k1:${key}`,
    });
    expect(cfg.databaseUrl).toBe('postgres://x');
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        SECRET_DATABASE_URL: 'postgres://x',
        SECRET_REDIS_URL: 'redis://x',
        SECRET_FIELD_ENCRYPTION_KEYS: `k1:${key}`,
      }),
    ).toThrow(/Missing required secret: database_url/);
  });

  it('reads secret files and rejects world-readable ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
    writeFileSync(join(dir, 'db'), 'value\n', { mode: 0o400 });
    expect(new FileSecretsProvider(dir, false).get('db')).toBe('value');
    writeFileSync(join(dir, 'later'), 'unused\n', { mode: 0o400 });
    expect(new FileSecretsProvider(dir, false).get('later')).toBeUndefined();
    writeFileSync(join(dir, 'open'), 'value', { mode: 0o644 });
    chmodSync(join(dir, 'open'), 0o644);
    expect(() => new FileSecretsProvider(dir, false).get('open')).toThrow(/world-readable/);
  });

  it('refuses insecure production settings', () => {
    const env = {
      ...base,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'false',
    };
    expect(() => loadConfig(env)).toThrow(/COOKIE_SECURE/);
  });

  it('requires distinct portal and agent hosts', () => {
    expect(() => loadConfig({ ...base, AGENT_HOST: base.PORTAL_HOST, NODE_ENV: 'test' })).toThrow(
      /different hosts/,
    );
  });

  it('parses and validates field encryption keys', () => {
    expect(parseFieldKeys(`k2:${key},k1:${key}`).map((k) => k.id)).toEqual(['k2', 'k1']);
    expect(() => parseFieldKeys('k1:c2hvcnQ=')).toThrow(/32 bytes/);
  });
});
