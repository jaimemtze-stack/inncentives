import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT,
  Browser,
  createTestContext,
  createUser,
  generateTotpSecret,
  PASSWORD,
  PORTAL,
  resetDatabase,
  totpNow,
  type TestContext,
} from './helpers';
import { RedisService } from '../src/common/redis/redis.service';

let ctx: TestContext;
let orgId: string;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(async () => {
  await resetDatabase(ctx);
  const plan = await ctx.prisma.supportPlan.findFirstOrThrow();
  orgId = (
    await ctx.prisma.organization.create({
      data: { name: 'ACME', domains: ['acme.test'], supportPlanId: plan.id },
    })
  ).id;
});
afterAll(() => ctx.close());

const portal = () => new Browser(ctx.app, PORTAL);
const agentHost = () => new Browser(ctx.app, AGENT);

async function loginWithMfa(b: Browser, email: string, secret: string) {
  const r = await b.login(email);
  expect(r.json().status).toBe('mfa_required');
  const v = await b.post('/api/v1/auth/mfa/verify', { code: totpNow(secret) });
  expect(v.statusCode).toBe(200);
  return b;
}

describe('hosts and CSRF', () => {
  it('unknown hosts get 404', async () => {
    const r = await new Browser(ctx.app, 'evil.example').get('/api/v1/auth/csrf');
    expect(r.statusCode).toBe(404);
  });

  it('health endpoints answer on any host', async () => {
    const b = new Browser(ctx.app, '10.0.0.5:3000');
    expect((await b.get('/health')).json()).toEqual({ status: 'ok' });
    expect((await b.get('/ready')).json()).toEqual({ status: 'ready', db: true, redis: true });
  });

  it('state-changing requests require a valid CSRF token', async () => {
    await createUser(ctx, { email: 'c@acme.test', roles: ['customer'], organizationId: orgId });
    const b = portal();
    const noToken = await b.post('/api/v1/auth/login', {
      email: 'c@acme.test',
      password: PASSWORD,
    });
    expect(noToken.statusCode).toBe(403);
    expect(noToken.json().message).toBe('csrf_invalid');

    await b.bootstrap();
    const forged = await b.post(
      '/api/v1/auth/login',
      { email: 'c@acme.test', password: PASSWORD },
      { 'x-csrf-token': 'a.b' },
    );
    expect(forged.statusCode).toBe(403);

    // A token issued for another session (binding) is rejected.
    const other = portal();
    await other.bootstrap();
    b.csrf = other.csrf;
    b.cookies.set('__Host-inn_portal_csrf', other.csrf!);
    expect(
      (await b.post('/api/v1/auth/login', { email: 'c@acme.test', password: PASSWORD })).statusCode,
    ).toBe(200);
    const stale = b.csrf;
    // After login the token is re-bound to the session; the anonymous token no longer works.
    b.csrf = other.csrf;
    b.cookies.set('__Host-inn_portal_csrf', other.csrf!);
    expect((await b.post('/api/v1/auth/logout')).statusCode).toBe(403);
    b.csrf = stale;
    b.cookies.set('__Host-inn_portal_csrf', stale!);
    expect((await b.post('/api/v1/auth/logout')).statusCode).toBe(204);
  });
});

describe('login', () => {
  it('customer signs in on the portal with hardened cookies', async () => {
    await createUser(ctx, { email: 'c@acme.test', roles: ['customer'], organizationId: orgId });
    const b = portal();
    const r = await b.login('C@ACME.test');
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('ok');
    const setCookie = ([] as string[]).concat(r.headers['set-cookie'] as string[]);
    const sid = setCookie.find((c) => c.startsWith('__Host-inn_portal_sid='))!;
    expect(sid).toMatch(/HttpOnly/);
    expect(sid).toMatch(/Secure/);
    expect(sid).toMatch(/SameSite=Lax/);
    expect(sid).toMatch(/Path=\//);
    expect(sid).not.toMatch(/Domain=/i);
    const me = await b.get('/api/v1/auth/me');
    expect(me.json()).toMatchObject({ email: 'c@acme.test', roles: ['customer'], area: 'portal' });
    expect(me.json().passwordHash).toBeUndefined();
  });

  it('does not reveal whether an account exists, is blocked or belongs to another area', async () => {
    await createUser(ctx, { email: 'c@acme.test', roles: ['customer'], organizationId: orgId });
    await createUser(ctx, {
      email: 'blocked@acme.test',
      roles: ['customer'],
      organizationId: orgId,
      status: 'blocked',
    });
    const bodies = await Promise.all([
      agentHost().login('c@acme.test'),
      portal().login('c@acme.test', 'wrong password!!'),
      portal().login('nobody@acme.test'),
      portal().login('blocked@acme.test'),
    ]);
    for (const r of bodies) {
      expect(r.statusCode).toBe(401);
      expect(r.json().message).toBe('invalid_credentials');
    }
  });

  it('a portal session cookie is not valid on the agent host', async () => {
    await createUser(ctx, { email: 'c@acme.test', roles: ['customer'], organizationId: orgId });
    const b = portal();
    await b.login('c@acme.test');
    b.host = AGENT;
    expect((await b.get('/api/v1/auth/me')).statusCode).toBe(401);
  });

  it('locks the account after repeated failures', async () => {
    await createUser(ctx, { email: 'c@acme.test', roles: ['customer'], organizationId: orgId });
    const b = portal();
    await b.bootstrap();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (await b.post('/api/v1/auth/login', { email: 'c@acme.test', password: 'wrong password!!' }))
          .statusCode,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    // Even the right password is refused while locked
    expect(
      (await b.post('/api/v1/auth/login', { email: 'c@acme.test', password: PASSWORD })).statusCode,
    ).toBe(429);
    const actions = (await ctx.prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).toContain('auth.login.locked');
  }, 60_000);

  it('notifies a login from a new device', async () => {
    await createUser(ctx, { email: 'c@acme.test', roles: ['customer'], organizationId: orgId });
    const first = portal();
    await first.login('c@acme.test');
    expect(ctx.mail.last('new_device_login')).toBeUndefined();
    const again = portal();
    again.cookies.set('__Host-inn_portal_dev', first.cookies.get('__Host-inn_portal_dev')!);
    await again.login('c@acme.test');
    expect(ctx.mail.last('new_device_login')).toBeUndefined();
    await portal().login('c@acme.test');
    expect(ctx.mail.last('new_device_login')?.to).toBe('c@acme.test');
  });

  it('logout destroys the session server-side', async () => {
    await createUser(ctx, { email: 'c@acme.test', roles: ['customer'], organizationId: orgId });
    const b = portal();
    await b.login('c@acme.test');
    const stolen = new Map(b.cookies);
    expect((await b.post('/api/v1/auth/logout')).statusCode).toBe(204);
    const attacker = portal();
    attacker.cookies = stolen;
    expect((await attacker.get('/api/v1/auth/me')).statusCode).toBe(401);
  });
});

describe('MFA', () => {
  it('agents must enroll MFA before using the application', async () => {
    await createUser(ctx, {
      email: 'a@neitek.test',
      roles: ['agent'],
      groups: { 'Soporte N1': ['full'] },
    });
    const b = agentHost();
    const r = await b.login('a@neitek.test');
    expect(r.json().status).toBe('mfa_setup_required');
    expect((await b.get('/api/v1/auth/me')).json().mfaSetupRequired).toBe(true);
    const blocked = await b.get('/api/v1/auth/sessions');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().message).toBe('mfa_setup_required');

    const setup = (await b.post('/api/v1/auth/mfa/setup')).json();
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect((await b.post('/api/v1/auth/mfa/enable', { code: '000000' })).statusCode).toBe(400);
    const enabled = await b.post('/api/v1/auth/mfa/enable', { code: totpNow(setup.secret) });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().recoveryCodes).toHaveLength(10);
    expect((await b.get('/api/v1/auth/sessions')).statusCode).toBe(200);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'a@neitek.test' } });
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaSecretEnc).not.toContain(setup.secret);
    expect(user.mfaRecoveryCodes.every((h) => h.startsWith('$argon2id$'))).toBe(true);
    expect(ctx.mail.last('mfa_changed')?.vars.change).toBe('enabled');
  });

  it('second factor: wrong code, valid code with rotation, and replay protection', async () => {
    const secret = generateTotpSecret();
    await createUser(ctx, { email: 'a@neitek.test', roles: ['agent'], mfaSecret: secret });
    const b = agentHost();
    expect((await b.login('a@neitek.test')).json().status).toBe('mfa_required');
    const pendingSid = b.cookies.get('__Host-inn_agent_sid');
    expect((await b.get('/api/v1/auth/me')).json().message).toBe('mfa_required');
    expect((await b.post('/api/v1/auth/mfa/verify', { code: '000000' })).statusCode).toBe(401);
    const code = totpNow(secret);
    expect((await b.post('/api/v1/auth/mfa/verify', { code })).statusCode).toBe(200);
    expect(b.cookies.get('__Host-inn_agent_sid')).not.toBe(pendingSid);
    expect((await b.get('/api/v1/auth/me')).statusCode).toBe(200);

    const replay = agentHost();
    await replay.login('a@neitek.test');
    expect((await replay.post('/api/v1/auth/mfa/verify', { code })).statusCode).toBe(401);
  });

  it('recovery codes work once', async () => {
    const b = agentHost();
    await createUser(ctx, { email: 'a@neitek.test', roles: ['agent'] });
    await b.login('a@neitek.test');
    const setup = (await b.post('/api/v1/auth/mfa/setup')).json();
    const { recoveryCodes } = (
      await b.post('/api/v1/auth/mfa/enable', { code: totpNow(setup.secret) })
    ).json();
    await ctx.app.get(RedisService).flushdb(); // clear TOTP replay keys and throttles

    const c1 = agentHost();
    await c1.login('a@neitek.test');
    expect((await c1.post('/api/v1/auth/mfa/verify', { code: recoveryCodes[0] })).statusCode).toBe(
      200,
    );
    const c2 = agentHost();
    await c2.login('a@neitek.test');
    expect((await c2.post('/api/v1/auth/mfa/verify', { code: recoveryCodes[0] })).statusCode).toBe(
      401,
    );
  });

  it('replacing an MFA factor requires re-authentication', async () => {
    const secret = generateTotpSecret();
    await createUser(ctx, { email: 'a@neitek.test', roles: ['agent'], mfaSecret: secret });
    const b = await loginWithMfa(agentHost(), 'a@neitek.test', secret);
    // verify sets reauthAt; simulate time passing by clearing it
    const redis = ctx.app.get(RedisService);
    for (const key of await redis.keys('sess:*')) {
      const s = JSON.parse((await redis.get(key))!);
      s.reauthAt = Date.now() - 10 * 60_000;
      await redis.set(key, JSON.stringify(s), 'KEEPTTL');
    }
    const denied = await b.post('/api/v1/auth/mfa/setup');
    expect(denied.statusCode).toBe(401);
    expect(denied.json().message).toBe('reauth_required');
    expect((await b.post('/api/v1/auth/reauth', { password: PASSWORD })).statusCode).toBe(401);
    expect(
      (await b.post('/api/v1/auth/reauth', { password: PASSWORD, code: totpNow(secret, 1) }))
        .statusCode,
    ).toBe(200);
    expect((await b.post('/api/v1/auth/mfa/setup')).statusCode).toBe(200);
  });
});

describe('sessions', () => {
  it('lists and revokes own sessions', async () => {
    await createUser(ctx, { email: 'c@acme.test', roles: ['customer'], organizationId: orgId });
    const a = portal();
    const b = portal();
    await a.login('c@acme.test');
    await b.login('c@acme.test');
    const list = (await a.get('/api/v1/auth/sessions')).json().items as Array<{
      id: string;
      current: boolean;
    }>;
    expect(list).toHaveLength(2);
    const other = list.find((s) => !s.current)!;
    expect((await a.delete(`/api/v1/auth/sessions/${other.id}`)).statusCode).toBe(204);
    expect((await b.get('/api/v1/auth/me')).statusCode).toBe(401);
    expect((await a.delete('/api/v1/auth/sessions/not-a-session-id')).statusCode).toBe(400);
  });

  it('admins revoke sessions of any user (agent host only)', async () => {
    const secret = generateTotpSecret();
    await createUser(ctx, { email: 'admin@neitek.test', roles: ['admin'], mfaSecret: secret });
    const customer = await createUser(ctx, {
      email: 'c@acme.test',
      roles: ['customer'],
      organizationId: orgId,
    });
    const c = portal();
    await c.login('c@acme.test');
    const admin = await loginWithMfa(agentHost(), 'admin@neitek.test', secret);
    const r = await admin.delete(`/api/v1/admin/users/${customer.id}/sessions`);
    expect(r.statusCode).toBe(200);
    expect(r.json().revoked).toBe(1);
    expect((await c.get('/api/v1/auth/me')).statusCode).toBe(401);
    // Admin endpoints are invisible on the portal host and to customers
    expect((await c.login('c@acme.test')).statusCode).toBe(200);
    expect((await c.delete(`/api/v1/admin/users/${customer.id}/sessions`)).statusCode).toBe(404);
  });
});

describe('password reset', () => {
  it('responds identically for unknown accounts and resets with a single-use token', async () => {
    await createUser(ctx, { email: 'c@acme.test', roles: ['customer'], organizationId: orgId });
    const b = portal();
    await b.bootstrap();
    const unknown = await b.post('/api/v1/auth/password/forgot', { email: 'nobody@acme.test' });
    const known = await b.post('/api/v1/auth/password/forgot', { email: 'c@acme.test' });
    expect(unknown.statusCode).toBe(202);
    expect(known.statusCode).toBe(202);
    expect(unknown.body).toBe(known.body);
    expect(ctx.mail.sent.filter((m) => m.template === 'password_reset')).toHaveLength(1);

    const session = portal();
    await session.login('c@acme.test');

    const token = new URL(ctx.mail.last('password_reset')!.vars.link!).hash.split('=')[1]!;
    const stored = await ctx.prisma.oneTimeToken.findFirstOrThrow();
    expect(stored.tokenHash).not.toBe(token);

    expect(
      (await b.post('/api/v1/auth/password/reset', { token, password: 'password1234' })).json()
        .message,
    ).toBe('password_breached');
    expect(
      (await b.post('/api/v1/auth/password/reset', { token, password: 'corto' })).statusCode,
    ).toBe(400);
    expect(
      (await b.post('/api/v1/auth/password/reset', { token, password: 'nueva frase segura' }))
        .statusCode,
    ).toBe(200);
    expect(
      (await b.post('/api/v1/auth/password/reset', { token, password: 'otra frase segura' })).json()
        .message,
    ).toBe('token_invalid');
    expect((await session.get('/api/v1/auth/me')).statusCode).toBe(401);
    expect((await portal().login('c@acme.test', 'nueva frase segura')).statusCode).toBe(200);
    expect(ctx.mail.last('password_changed')?.to).toBe('c@acme.test');
  });

  it('expired tokens are rejected', async () => {
    await createUser(ctx, { email: 'c@acme.test', roles: ['customer'], organizationId: orgId });
    const b = portal();
    await b.bootstrap();
    await b.post('/api/v1/auth/password/forgot', { email: 'c@acme.test' });
    const token = new URL(ctx.mail.last('password_reset')!.vars.link!).hash.split('=')[1]!;
    await ctx.prisma.oneTimeToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(
      (await b.post('/api/v1/auth/password/reset', { token, password: 'nueva frase segura' }))
        .statusCode,
    ).toBe(400);
  });
});

describe('invitations', () => {
  it('admin invites a customer who sets a password; tokens are single-use', async () => {
    const secret = generateTotpSecret();
    await createUser(ctx, { email: 'admin@neitek.test', roles: ['admin'], mfaSecret: secret });
    const admin = await loginWithMfa(agentHost(), 'admin@neitek.test', secret);
    const r = await admin.post('/api/v1/admin/users/invitations', {
      email: 'nuevo@acme.test',
      firstname: 'Nuevo',
      lastname: 'Cliente',
      organizationId: orgId,
      roles: ['customer'],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe('invited');
    const mail = ctx.mail.last('invitation')!;
    expect(mail.vars.link).toMatch(new RegExp(`^https://${PORTAL}/accept-invitation#token=`));
    const token = mail.vars.link!.split('=')[1]!;

    // Invited users cannot log in yet
    expect((await portal().login('nuevo@acme.test')).statusCode).toBe(401);

    const b = portal();
    await b.bootstrap();
    expect(
      (await b.post('/api/v1/auth/invitations/accept', { token, password: 'mi frase de acceso' }))
        .statusCode,
    ).toBe(200);
    expect(
      (await b.post('/api/v1/auth/invitations/accept', { token, password: 'mi frase de acceso' }))
        .statusCode,
    ).toBe(400);
    expect((await portal().login('nuevo@acme.test', 'mi frase de acceso')).json().status).toBe(
      'ok',
    );

    const actions = (await ctx.prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['user.invited', 'user.invitation.accepted']));

    // Existing active user cannot be re-invited
    const dup = await admin.post('/api/v1/admin/users/invitations', {
      email: 'nuevo@acme.test',
      firstname: 'X',
      lastname: 'Y',
      organizationId: orgId,
      roles: ['customer'],
    });
    expect(dup.statusCode).toBe(409);
  });

  it('agents may invite customers but not agents; customers may not invite', async () => {
    const secret = generateTotpSecret();
    await createUser(ctx, { email: 'a@neitek.test', roles: ['agent'], mfaSecret: secret });
    const agent = await loginWithMfa(agentHost(), 'a@neitek.test', secret);
    const base = { firstname: 'X', lastname: 'Y', organizationId: orgId };
    expect(
      (
        await agent.post('/api/v1/admin/users/invitations', {
          ...base,
          email: 'n@acme.test',
          roles: ['customer'],
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await agent.post('/api/v1/admin/users/invitations', {
          ...base,
          email: 'm@neitek.test',
          roles: ['agent'],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await agent.post('/api/v1/admin/users/invitations', {
          firstname: 'X',
          lastname: 'Y',
          email: 'o@acme.test',
          roles: ['customer'],
        })
      ).json().message,
    ).toBe('organization_required');

    await createUser(ctx, { email: 'c@acme.test', roles: ['customer'], organizationId: orgId });
    const customer = portal();
    await customer.login('c@acme.test');
    customer.host = PORTAL;
    expect(
      (
        await customer.post('/api/v1/admin/users/invitations', {
          ...base,
          email: 'p@acme.test',
          roles: ['customer'],
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('audit API', () => {
  it('admins list and verify the audit trail; agents cannot', async () => {
    const secret = generateTotpSecret();
    await createUser(ctx, { email: 'admin@neitek.test', roles: ['admin'], mfaSecret: secret });
    const s2 = generateTotpSecret();
    await createUser(ctx, { email: 'a@neitek.test', roles: ['agent'], mfaSecret: s2 });
    const agent = await loginWithMfa(agentHost(), 'a@neitek.test', s2);
    const admin = await loginWithMfa(agentHost(), 'admin@neitek.test', secret);
    const page = (await admin.get('/api/v1/admin/audit?limit=2')).json();
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toMatch(/^\d+$/);
    const next = (await admin.get(`/api/v1/admin/audit?limit=2&cursor=${page.nextCursor}`)).json();
    expect(next.items[0].id).not.toBe(page.items[0].id);
    expect((await admin.get('/api/v1/admin/audit/verify')).json().ok).toBe(true);
    expect((await admin.get('/api/v1/admin/audit?limit=1000')).statusCode).toBe(400);

    expect((await agent.get('/api/v1/admin/audit')).statusCode).toBe(403);
  });
});
