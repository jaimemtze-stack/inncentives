import { describe, expect, it } from 'vitest';
import { acceptInvitationSchema, loginSchema, passwordSchema } from './auth';
import { headerSafeString, paginationSchema } from './common';

describe('auth schemas', () => {
  it('passwords: 12+ chars, no composition rules, unicode allowed', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(true);
    expect(passwordSchema.safeParse('ñandú ñandú ñandú').success).toBe(true);
    expect(passwordSchema.safeParse('x'.repeat(257)).success).toBe(false);
  });
  it('normalizes e-mail', () => {
    expect(loginSchema.parse({ email: '  Ana@Example.COM ', password: 'x' }).email).toBe(
      'ana@example.com',
    );
  });
  it('tokens are 43-char base64url', () => {
    const ok = acceptInvitationSchema.safeParse({
      token: 'a'.repeat(43),
      password: 'a long enough pass',
    });
    expect(ok.success).toBe(true);
    expect(
      acceptInvitationSchema.safeParse({ token: '../etc', password: 'a long enough pass' }).success,
    ).toBe(false);
  });
  it('pagination defaults and bounds', () => {
    expect(paginationSchema.parse({}).limit).toBe(25);
    expect(paginationSchema.safeParse({ limit: 1000 }).success).toBe(false);
  });
  it('header-safe strings reject CR/LF', () => {
    expect(headerSafeString().safeParse('ok').success).toBe(true);
    expect(headerSafeString().safeParse('a\r\nBcc: x').success).toBe(false);
  });
});
