import { describe, expect, it } from 'vitest';
import { canonicalJson, computeHash, GENESIS_HASH, redact } from './audit.service';

describe('audit helpers', () => {
  it('produces canonical JSON independent of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 0, f: 1 }], d: 2 }, b: 1 }),
    );
  });

  it('redacts sensitive keys at any depth', () => {
    expect(redact({ email: 'a@b.mx', password: 'x', nested: { resetToken: 'y', ok: 1 } })).toEqual({
      email: 'a@b.mx',
      password: '[redacted]',
      nested: { resetToken: '[redacted]', ok: 1 },
    });
  });

  it('chains hashes so a modified row changes every later hash', () => {
    const row = {
      occurredAt: new Date('2026-10-17T00:00:00.000Z'),
      actorType: 'user',
      actorUserId: null,
      action: 'auth.login.succeeded',
      targetType: null,
      targetId: null,
      organizationId: null,
      ip: '203.0.113.5',
      userAgent: null,
      correlationId: null,
      data: null,
    };
    const h1 = computeHash(GENESIS_HASH, row);
    const h2 = computeHash(h1, { ...row, action: 'auth.logout' });
    expect(computeHash(GENESIS_HASH, { ...row, ip: '203.0.113.6' })).not.toBe(h1);
    expect(
      computeHash(computeHash(GENESIS_HASH, { ...row, ip: 'x' }), {
        ...row,
        action: 'auth.logout',
      }),
    ).not.toBe(h2);
  });
});
