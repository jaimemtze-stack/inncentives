import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginThrottleService } from '../src/modules/auth/login-throttle.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { SessionService } from '../src/modules/auth/session.service';
import { RedisService } from '../src/common/redis/redis.service';
import {
  createTestContext,
  fakeHibp,
  resetDatabase,
  testConfig,
  type TestContext,
} from './helpers';

describe('SessionService', () => {
  let ctx: TestContext;
  let sessions: SessionService;
  beforeAll(async () => {
    ctx = await createTestContext();
    sessions = ctx.app.get(SessionService);
  });
  beforeEach(() => resetDatabase(ctx));
  afterAll(() => ctx.close());

  const base = {
    userId: 'u1',
    area: 'agent' as const,
    mfaPending: false,
    mfaSetupRequired: false,
    ip: '1.1.1.1',
    userAgent: 'x',
  };

  it('stores only the hash of the session id', async () => {
    const { id, info } = await sessions.create(base);
    const redis = ctx.app.get(RedisService);
    expect(await redis.exists(`sess:${id}`)).toBe(0);
    expect(await redis.exists(`sess:${info.hash}`)).toBe(1);
    expect(await sessions.load('not-a-valid-id')).toBeNull();
  });

  it('expires after inactivity (30 min) and absolute lifetime (12 h)', async () => {
    const t0 = Date.now();
    const { id } = await sessions.create(base, t0);
    expect(await sessions.load(id, t0 + 29 * 60_000)).not.toBeNull();
    expect(await sessions.load(id, t0 + 29 * 60_000 + 31 * 60_000)).toBeNull();

    const s2 = await sessions.create(base, t0);
    let t = t0;
    while (await sessions.load(s2.id, t + 29 * 60_000)) t += 29 * 60_000;
    const diedAt = t + 29 * 60_000 - t0;
    expect(diedAt).toBeGreaterThan(12 * 3_600_000);
    expect(diedAt).toBeLessThanOrEqual(12 * 3_600_000 + 29 * 60_000);
  });

  it('rotates ids, lists and revokes', async () => {
    const a = await sessions.create(base);
    const b = await sessions.create(base);
    const rotated = await sessions.rotate(a.info, { reauthAt: 123 });
    expect(rotated.id).not.toBe(a.id);
    expect(await sessions.load(a.id)).toBeNull();
    expect((await sessions.load(rotated.id))?.reauthAt).toBe(123);
    expect(await sessions.list('u1')).toHaveLength(2);
    expect(await sessions.revokeByPublicId('u1', sessions.publicId(b.info))).toBe(true);
    expect(await sessions.revokeByPublicId('u1', 'ffffffffffffffff')).toBe(false);
    expect(await sessions.revokeAll('u1')).toBe(1);
    expect(await sessions.list('u1')).toHaveLength(0);
  });
});

describe('LoginThrottleService', () => {
  let ctx: TestContext;
  let throttle: LoginThrottleService;
  beforeAll(async () => {
    ctx = await createTestContext();
    throttle = ctx.app.get(LoginThrottleService);
  });
  beforeEach(() => resetDatabase(ctx));
  afterAll(() => ctx.close());

  it('adds progressive delays and then locks the account', async () => {
    for (let i = 0; i < 5; i++) await throttle.fail('login', 'a@x.test', '1.1.1.1');
    expect(await throttle.check('login', 'a@x.test', '1.1.1.1')).toEqual({
      allowed: true,
      delayMs: 250,
    });
    await throttle.fail('login', 'a@x.test', '1.1.1.1');
    expect(await throttle.check('login', 'A@X.test', '2.2.2.2')).toEqual({
      allowed: true,
      delayMs: 500,
    });
    let locked = false;
    for (let i = 0; i < 4; i++) locked = await throttle.fail('login', 'a@x.test', '1.1.1.1');
    expect(locked).toBe(true);
    const d = await throttle.check('login', 'a@x.test', '3.3.3.3');
    expect(d.allowed).toBe(false);
    // Other accounts unaffected
    expect((await throttle.check('login', 'b@x.test', '3.3.3.3')).allowed).toBe(true);
  });

  it('limits attempts per IP across accounts', async () => {
    const original = throttle.policy;
    throttle.policy = { ...original, ipLimit: 3 };
    try {
      for (const e of ['a', 'b', 'c']) await throttle.fail('login', `${e}@x.test`, '9.9.9.9');
      expect((await throttle.check('login', 'z@x.test', '9.9.9.9')).allowed).toBe(false);
      expect((await throttle.check('login', 'z@x.test', '8.8.8.8')).allowed).toBe(true);
    } finally {
      throttle.policy = original;
    }
  });

  it('resets the account counter on success', async () => {
    for (let i = 0; i < 6; i++) await throttle.fail('mfa', 'u', '1.1.1.1');
    await throttle.succeed('mfa', 'u');
    expect(await throttle.check('mfa', 'u', '1.1.1.1')).toEqual({ allowed: true, delayMs: 0 });
  });
});

describe('PasswordService', () => {
  const cfg = testConfig();
  it('hashes with Argon2id and verifies', async () => {
    const svc = new PasswordService(cfg, fakeHibp());
    const h = await svc.hash('una frase larga de prueba');
    expect(h.startsWith('$argon2id$v=19$m=19456,p=1,t=2$')).toBe(true);
    expect(await svc.verify(h, 'una frase larga de prueba')).toBe(true);
    expect(await svc.verify(h, 'otra')).toBe(false);
    expect(await svc.verify(null, 'x')).toBe(false);
    expect(await svc.verify('garbage', 'x')).toBe(false);
    expect(svc.needsRehash(h)).toBe(false);
  });

  it('checks HIBP with k-anonymity and fails open', async () => {
    const seen: string[] = [];
    const svc = new PasswordService(cfg, async (url) => {
      seen.push(url);
      return fakeHibp()(url);
    });
    expect(await svc.isBreached('password1234')).toBe(true);
    expect(await svc.isBreached('una frase que no está filtrada')).toBe(false);
    expect(seen.every((u) => /\/range\/[0-9A-F]{5}$/.test(u))).toBe(true);

    const down = new PasswordService(cfg, async () => {
      throw new Error('offline');
    });
    expect(await down.isBreached('password1234')).toBe(false);
    const disabled = new PasswordService({ ...cfg, HIBP_ENABLED: false }, fakeHibp());
    expect(await disabled.isBreached('password1234')).toBe(false);
  });
});
