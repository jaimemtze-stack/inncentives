import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hotp,
  otpauthUri,
  verifyTotp,
} from './totp';

const RFC_SECRET = Buffer.from('12345678901234567890');

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  it('matches RFC 4226 HOTP vectors', () => {
    expect([0, 1, 2, 3, 4].map((i) => hotp(RFC_SECRET, i))).toEqual([
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
    ]);
  });

  it('matches RFC 6238 SHA-1 vectors (6 digits)', () => {
    const b32 = base32Encode(RFC_SECRET);
    expect(verifyTotp(b32, '287082', 59_000, 0)).toBe(1);
    expect(verifyTotp(b32, '081804', 1_111_111_109_000, 0)).not.toBeNull();
    expect(verifyTotp(b32, '005924', 1_234_567_890_000, 0)).not.toBeNull();
  });

  it('accepts ±1 step and rejects others', () => {
    const s = generateTotpSecret();
    const now = 1_760_000_000_000;
    const step = Math.floor(now / 30_000);
    const key = base32Decode(s);
    expect(verifyTotp(s, hotp(key, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(s, hotp(key, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(s, hotp(key, step + 2), now)).toBeNull();
    expect(verifyTotp(s, 'abcdef', now)).toBeNull();
  });

  it('base32 round-trips and rejects invalid input', () => {
    const buf = Buffer.from('hola mundo!');
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(() => base32Decode('1!')).toThrow();
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('builds otpauth URIs and recovery codes', () => {
    expect(otpauthUri('ABC', 'ana@x.test', 'Soporte Inncentives')).toBe(
      'otpauth://totp/Soporte%20Inncentives%3Aana%40x.test?secret=ABC&issuer=Soporte%20Inncentives&algorithm=SHA1&digits=6&period=30',
    );
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
  });
});
