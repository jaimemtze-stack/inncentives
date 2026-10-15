import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FieldCrypto } from './field-crypto';
import { randomToken, safeEqual, sha256 } from './tokens';

describe('FieldCrypto (AES-256-GCM)', () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);

  it('round-trips with AAD and random IVs', () => {
    const c = new FieldCrypto([k1]);
    const a = c.encrypt('secreto', 'totp:1');
    const b = c.encrypt('secreto', 'totp:1');
    expect(a).not.toBe(b);
    expect(c.decrypt(a, 'totp:1')).toBe('secreto');
  });

  it('detects tampering and wrong AAD', () => {
    const c = new FieldCrypto([k1]);
    const enc = c.encrypt('secreto', 'a');
    expect(() => c.decrypt(enc, 'b')).toThrow();
    const parts = enc.split('.');
    parts[4] = Buffer.from('xxxx').toString('base64url');
    expect(() => c.decrypt(parts.join('.'), 'a')).toThrow();
    expect(() => c.decrypt('v0.0.a.b.c')).toThrow();
    // Truncated authentication tag is rejected before decryption
    const short = enc.split('.');
    short[3] = Buffer.from(short[3]!, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => c.decrypt(short.join('.'), 'a')).toThrow(/authentication tag/);
  });

  it('supports key rotation', () => {
    const old = new FieldCrypto([k1]);
    const rotated = new FieldCrypto([k2, k1]);
    expect(rotated.decrypt(old.encrypt('x'))).toBe('x');
    expect(() => new FieldCrypto([])).toThrow();
    expect(() => new FieldCrypto([randomBytes(16)])).toThrow();
  });
});

describe('tokens', () => {
  it('generates 256-bit base64url tokens', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256('a')).toHaveLength(64);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
