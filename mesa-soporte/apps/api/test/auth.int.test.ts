import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AGENT,
  Client,
  PASSWORD,
  PORTAL,
  makeOrg,
  makeUser,
  startApp,
  tokenFromMail,
  type TestApp,
} from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => t.close());

describe('login', () => {
  it('requires staff to enroll MFA before anything else', async () => {
    const org = await makeOrg(t.prisma, { internal: true });
    const admin = await makeUser(t.prisma, 'ADMIN', org.id);
    const c = new Client(t.app, AGENT);
    const login = await c.login(admin.email);
    expect(login.statusCode).toBe(200);
    expect(login.json().state).toBe('mfa_enrollment_required');
    expect(login.headers['set-cookie']).toMatch(
      /__Host-sid=.*; Max-Age=43200; Path=\/; HttpOnly; Secure; SameSite=Lax/,
    );

    const blocked = await c.get('/api/v1/admin/organizations');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('mfa_enrollment_required');
    expect((await c.get('/api/v1/auth/me')).json().state).toBe('mfa_enrollment_required');

    const setup = await c.post('/api/v1/auth/mfa/totp/setup');
    expect(setup.json().otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const bad = await c.post('/api/v1/auth/mfa/totp/confirm', { code: '000000' });
    expect(bad.statusCode).toBe(401);
    const cookieBefore = c.cookie;
    const ok = await c.post('/api/v1/auth/mfa/totp/confirm', {
      code: authenticator.generate(setup.json().secret),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().recoveryCodes).toHaveLength(10);
    expect(ok.json().state).toBe('authenticated');
    expect(c.cookie).not.toBe(cookieBefore); // session id rotated

    expect((await c.get('/api/v1/admin/organizations')).statusCode).toBe(200);
    const stored = await t.prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored.totpSecretEnc).toMatch(/^v1:k1:/);
    expect(stored.totpSecretEnc).not.toContain(setup.json().secret);
    expect(t.mails.some((m) => m.template === 'mfa_enabled' && m.to === admin.email)).toBe(true);
  });

  it('asks enrolled users for a code, rejects replays and accepts recovery codes once', async () => {
    const org = await makeOrg(t.prisma, { internal: true });
    const agent = await makeUser(t.prisma, 'AGENT', org.id);
    const c = new Client(t.app, AGENT);
    const { secret, recoveryCodes } = await c.loginAndEnroll(agent.email);
    await c.post('/api/v1/auth/logout');
    expect((await c.get('/api/v1/auth/me')).statusCode).toBe(401);

    const login = await c.login(agent.email);
    expect(login.json().state).toBe('mfa_required');
    expect((await c.get('/api/v1/admin/organizations')).json().error.code).toBe('mfa_required');
    // Same code that was used for the enrollment, still in its time window.
    const replay = await c.post('/api/v1/auth/mfa/verify', {
      code: authenticator.generate(secret),
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('mfa_invalid');

    const viaRecovery = await c.post('/api/v1/auth/mfa/verify', { recoveryCode: recoveryCodes[0] });
    expect(viaRecovery.statusCode).toBe(200);
    expect(viaRecovery.json().state).toBe('authenticated');

    await c.post('/api/v1/auth/logout');
    await c.login(agent.email);
    const reused = await c.post('/api/v1/auth/mfa/verify', { recoveryCode: recoveryCodes[0] });
    expect(reused.statusCode).toBe(401);
  });

  it('closes the pending session after five wrong codes', async () => {
    const org = await makeOrg(t.prisma, { internal: true });
    const agent = await makeUser(t.prisma, 'AGENT', org.id);
    const c = new Client(t.app, AGENT);
    await c.loginAndEnroll(agent.email);
    await c.post('/api/v1/auth/logout');
    await c.login(agent.email);
    for (let i = 0; i < 4; i++)
      expect((await c.post('/api/v1/auth/mfa/verify', { code: '000000' })).statusCode).toBe(401);
    const fifth = await c.post('/api/v1/auth/mfa/verify', { code: '000000' });
    expect(fifth.json().error.code).toBe('unauthenticated');
    expect((await c.get('/api/v1/auth/me')).statusCode).toBe(401);
  });

  it('logs customers in on the portal only, with one generic error', async () => {
    const org = await makeOrg(t.prisma);
    const customer = await makeUser(t.prisma, 'CUSTOMER', org.id);

    const wrongHost = await new Client(t.app, AGENT).login(customer.email);
    const wrongPassword = await new Client(t.app, PORTAL).login(
      customer.email,
      'otra frase incorrecta',
    );
    const unknown = await new Client(t.app, PORTAL).login('nadie@example.test');
    for (const r of [wrongHost, wrongPassword, unknown]) {
      expect(r.statusCode).toBe(401);
      expect(r.json().error).toMatchObject({
        code: 'invalid_credentials',
        message: 'Invalid email or password.',
      });
    }

    const c = new Client(t.app, PORTAL);
    const ok = await c.login(customer.email);
    expect(ok.json().state).toBe('authenticated');
    const me = await c.get('/api/v1/auth/me');
    expect(me.json()).toMatchObject({
      area: 'portal',
      user: { email: customer.email, role: 'CUSTOMER', mfaEnabled: false },
    });
    expect(JSON.stringify(me.json())).not.toMatch(/passwordHash|totpSecret/);

    const admin = await c.get('/api/v1/admin/organizations');
    expect(admin.statusCode).toBe(421);
  });

  it('requires MFA enrollment for customers when their organization demands it', async () => {
    const org = await makeOrg(t.prisma, { mfaRequired: true });
    const customer = await makeUser(t.prisma, 'CUSTOMER', org.id);
    const res = await new Client(t.app, PORTAL).login(customer.email);
    expect(res.json().state).toBe('mfa_enrollment_required');
  });

  it('does not accept a portal cookie on the agents host', async () => {
    const org = await makeOrg(t.prisma);
    const customer = await makeUser(t.prisma, 'CUSTOMER', org.id);
    const portal = new Client(t.app, PORTAL);
    await portal.login(customer.email);
    const agent = new Client(t.app, AGENT);
    agent.cookie = portal.cookie;
    expect((await agent.get('/api/v1/auth/me')).statusCode).toBe(401);
  });

  it('locks an account after five failed passwords, even for the right one', async () => {
    const org = await makeOrg(t.prisma);
    const customer = await makeUser(t.prisma, 'CUSTOMER', org.id);
    for (let i = 0; i < 5; i++) {
      const c = new Client(t.app, PORTAL); // different IPs: the account limit applies
      expect((await c.login(customer.email, 'contraseña equivocada')).statusCode).toBe(401);
    }
    const locked = await new Client(t.app, PORTAL).login(customer.email);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('rate_limited');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('rejects disabled users and ends their sessions', async () => {
    const org = await makeOrg(t.prisma);
    const customer = await makeUser(t.prisma, 'CUSTOMER', org.id);
    const c = new Client(t.app, PORTAL);
    await c.login(customer.email);
    await t.prisma.user.update({ where: { id: customer.id }, data: { status: 'DISABLED' } });
    expect((await c.get('/api/v1/auth/me')).statusCode).toBe(401);
    expect((await new Client(t.app, PORTAL).login(customer.email)).statusCode).toBe(401);
  });
});

describe('CSRF and sessions', () => {
  it('requires the session CSRF token on authenticated writes', async () => {
    const org = await makeOrg(t.prisma);
    const customer = await makeUser(t.prisma, 'CUSTOMER', org.id);
    const c = new Client(t.app, PORTAL);
    await c.login(customer.email);
    const missing = await c.delete('/api/v1/auth/sessions', { csrf: null });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error.code).toBe('csrf_failed');
    const wrong = await c.delete('/api/v1/auth/sessions', { csrf: 'x'.repeat(43) });
    expect(wrong.statusCode).toBe(403);
    expect((await c.delete('/api/v1/auth/sessions')).statusCode).toBe(200);
  });

  it("lists only own sessions and cannot revoke someone else's (IDOR)", async () => {
    const org = await makeOrg(t.prisma);
    const alice = await makeUser(t.prisma, 'CUSTOMER', org.id);
    const bob = await makeUser(t.prisma, 'CUSTOMER', org.id);
    const a = new Client(t.app, PORTAL);
    const b = new Client(t.app, PORTAL);
    await a.login(alice.email);
    await b.login(bob.email);
    const bobSessions = (await b.get('/api/v1/auth/sessions')).json();
    expect(bobSessions).toHaveLength(1);
    expect(bobSessions[0].current).toBe(true);

    const attack = await a.delete(`/api/v1/auth/sessions/${bobSessions[0].id}`);
    expect(attack.statusCode).toBe(404);
    expect((await b.get('/api/v1/auth/me')).statusCode).toBe(200);

    const mine = (await a.get('/api/v1/auth/sessions')).json();
    expect(mine.map((s: { id: string }) => s.id)).not.toContain(bobSessions[0].id);
  });

  it('needs a fresh password for sensitive changes', async () => {
    const org = await makeOrg(t.prisma);
    const customer = await makeUser(t.prisma, 'CUSTOMER', org.id);
    const c = new Client(t.app, PORTAL);
    const { secret } = await (async () => {
      await c.login(customer.email);
      const setup = await c.post('/api/v1/auth/mfa/totp/setup');
      await c.post('/api/v1/auth/mfa/totp/confirm', {
        code: authenticator.generate(setup.json().secret),
      });
      return { secret: setup.json().secret as string };
    })();
    expect(secret).toBeTruthy();
    // Login set reauthAt; simulate an old session.
    const sessionKey = (await import('../src/security/tokens')).sha256Hex(c.cookie!);
    const redis = t.app.get((await import('../src/redis/redis.module')).REDIS);
    const rec = JSON.parse((await redis.get(`sess:${sessionKey}`))!);
    rec.reauthAt = Date.now() - 60 * 60_000;
    await redis.set(`sess:${sessionKey}`, JSON.stringify(rec), 'KEEPTTL');

    const denied = await c.post('/api/v1/auth/mfa/recovery-codes');
    expect(denied.json().error.code).toBe('reauthentication_required');
    expect(
      (await c.post('/api/v1/auth/reauth', { password: 'incorrecta incorrecta' })).statusCode,
    ).toBe(401);
    expect((await c.post('/api/v1/auth/reauth', { password: PASSWORD })).statusCode).toBe(204);
    const codes = await c.post('/api/v1/auth/mfa/recovery-codes');
    expect(codes.json().recoveryCodes).toHaveLength(10);
  });
});

describe('password reset', () => {
  it('answers the same for unknown emails and resets with a one-time token', async () => {
    const org = await makeOrg(t.prisma);
    const customer = await makeUser(t.prisma, 'CUSTOMER', org.id);
    const other = new Client(t.app, PORTAL);
    await other.login(customer.email);

    const unknown = await new Client(t.app, PORTAL).post('/api/v1/auth/password/forgot', {
      email: 'nadie@example.test',
    });
    const known = await new Client(t.app, PORTAL).post('/api/v1/auth/password/forgot', {
      email: customer.email,
    });
    expect(unknown.statusCode).toBe(202);
    expect(known.statusCode).toBe(202);
    expect(unknown.json()).toEqual(known.json());

    const token = tokenFromMail(t.mails, 'password_reset', customer.email);
    const job = t.mails.find((m) => m.template === 'password_reset' && m.to === customer.email)!;
    expect('link' in job.params && job.params.link).toMatch(
      /^https:\/\/soporte\.test\/restablecer#token=/,
    );

    // A token for the portal does not work on the agents host.
    expect(
      (
        await new Client(t.app, AGENT).post('/api/v1/auth/password/reset', {
          token,
          password: 'una nueva frase segura 2026',
        })
      ).statusCode,
    ).toBe(400);

    const reset = await new Client(t.app, PORTAL).post('/api/v1/auth/password/reset', {
      token,
      password: 'una nueva frase segura 2026',
    });
    expect(reset.statusCode).toBe(204);
    expect(
      (
        await new Client(t.app, PORTAL).post('/api/v1/auth/password/reset', {
          token,
          password: 'otra frase segura 2026',
        })
      ).json().error.code,
    ).toBe('token_invalid');

    expect((await other.get('/api/v1/auth/me')).statusCode).toBe(401); // sessions closed
    expect((await new Client(t.app, PORTAL).login(customer.email)).statusCode).toBe(401);
    expect(
      (await new Client(t.app, PORTAL).login(customer.email, 'una nueva frase segura 2026'))
        .statusCode,
    ).toBe(200);
    expect(t.mails.some((m) => m.template === 'password_changed' && m.to === customer.email)).toBe(
      true,
    );
  });

  it('changes the password, closes other sessions and keeps this one', async () => {
    const org = await makeOrg(t.prisma);
    const customer = await makeUser(t.prisma, 'CUSTOMER', org.id);
    const a = new Client(t.app, PORTAL);
    const b = new Client(t.app, PORTAL);
    await a.login(customer.email);
    await b.login(customer.email);
    const res = await a.post('/api/v1/auth/password/change', {
      currentPassword: PASSWORD,
      newPassword: 'cambio de frase segura 2026',
    });
    expect(res.statusCode).toBe(200);
    expect((await a.get('/api/v1/auth/me')).statusCode).toBe(200);
    expect((await b.get('/api/v1/auth/me')).statusCode).toBe(401);
  });
});
