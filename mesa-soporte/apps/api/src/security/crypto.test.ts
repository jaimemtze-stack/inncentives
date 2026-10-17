import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FieldEncryption } from './field-encryption';
import { newRecoveryCode, newToken, safeEqual, sha256Hex } from './tokens';
import { PasswordService } from './password.service';
import type { AppConfig } from '../config/config';

describe('tokens', () => {
  it('creates 256-bit url-safe tokens', () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(t);
  });

  it('creates recovery codes in the expected format', () => {
    for (let i = 0; i < 50; i++) expect(newRecoveryCode()).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
  });

  it('compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(sha256Hex('x')).toHaveLength(64);
  });
});

describe('FieldEncryption', () => {
  const k1 = { id: 'k1', key: randomBytes(32) };
  const k2 = { id: 'k2', key: randomBytes(32) };

  it('round-trips and binds ciphertext to its context', () => {
    const fe = new FieldEncryption([k1]);
    const env = fe.encrypt('JBSWY3DPEHPK3PXP', 'user:1:totp');
    expect(env).not.toContain('JBSWY3DPEHPK3PXP');
    expect(fe.decrypt(env, 'user:1:totp')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => fe.decrypt(env, 'user:2:totp')).toThrow();
  });

  it('detects tampering', () => {
    const fe = new FieldEncryption([k1]);
    const parts = fe.encrypt('secret', 'ctx').split(':');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => fe.decrypt(parts.join(':'), 'ctx')).toThrow();
  });

  it('supports key rotation', () => {
    const old = new FieldEncryption([k1]).encrypt('secret', 'ctx');
    const rotated = new FieldEncryption([k2, k1]);
    expect(rotated.decrypt(old, 'ctx')).toBe('secret');
    expect(rotated.needsRotation(old)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt('secret', 'ctx'))).toBe(false);
  });
});

describe('PasswordService', () => {
  const config = {
    PWNED_PASSWORDS_CHECK: true,
    PWNED_PASSWORDS_URL: 'https://pwned.test/range/',
  } as AppConfig;
  const service = new PasswordService(config);

  it('hashes with argon2id and verifies', async () => {
    const h = await service.hash('correct horse battery staple');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await service.verify(h, 'correct horse battery staple')).toBe(true);
    expect(await service.verify(h, 'wrong')).toBe(false);
    expect(await service.verify('not-a-hash', 'x')).toBe(false);
  });

  it('sends only the SHA-1 prefix and detects breached passwords', async () => {
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const fetchMock = vi.fn(
      async () =>
        new Response(
          '1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n00000000000000000000000000000000000:0',
        ),
    );
    expect(await service.isBreached('password', fetchMock as unknown as typeof fetch)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://pwned.test/range/5BAA6', expect.anything());
    expect(
      await service.isBreached('a unique passphrase 9f8e', fetchMock as unknown as typeof fetch),
    ).toBe(false);
  });

  it('fails open when the service is unreachable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    expect(await service.isBreached('password', fetchMock as unknown as typeof fetch)).toBe(false);
  });
});
