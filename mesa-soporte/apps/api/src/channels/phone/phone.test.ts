import { describe, expect, it } from 'vitest';
import { normalizePhone, phoneDigits } from './phone';
import { signPayload, verifySignature } from './signature';

describe('phone numbers', () => {
  it('normalises Mexican numbers', () => {
    expect(normalizePhone('55 1234 5678')).toBe('+525512345678');
    expect(normalizePhone('+52 1 55 1234 5678')).toBe('+525512345678');
    expect(normalizePhone('abc')).toBeNull();
    expect(phoneDigits('+52 (55) 1234-5678')).toBe('5512345678');
  });
});

describe('webhook signatures', () => {
  const body = Buffer.from('{"event":"newCall"}');
  it('verifies fresh signatures only', () => {
    const now = 1_800_000_000;
    const sig = signPayload('s3cr3t', body, now);
    expect(verifySignature('s3cr3t', sig, body, now + 10).ok).toBe(true);
    expect(verifySignature('other', sig, body, now).ok).toBe(false);
    expect(verifySignature('s3cr3t', sig, Buffer.from('{"event":"hangup"}'), now).ok).toBe(false);
    expect(verifySignature('s3cr3t', sig, body, now + 301).ok).toBe(false);
    expect(verifySignature('s3cr3t', undefined, body, now).ok).toBe(false);
  });
});
