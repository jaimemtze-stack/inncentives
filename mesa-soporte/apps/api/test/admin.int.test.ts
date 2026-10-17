import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AGENT,
  Client,
  PORTAL,
  makeOrg,
  makeUser,
  startApp,
  tokenFromMail,
  uniqueEmail,
  type TestApp,
} from './helpers';

let t: TestApp;
let internalOrgId: string;
let admin: Client;
let agent: Client;

beforeAll(async () => {
  t = await startApp();
  const internal = await makeOrg(t.prisma, { internal: true });
  internalOrgId = internal.id;
  const a = await makeUser(t.prisma, 'ADMIN', internal.id);
  const g = await makeUser(t.prisma, 'AGENT', internal.id);
  admin = new Client(t.app, AGENT);
  agent = new Client(t.app, AGENT);
  await admin.loginAndEnroll(a.email);
  await agent.loginAndEnroll(g.email);
});
afterAll(async () => t.close());

describe('invitations', () => {
  it('invites a customer who sets a password on the portal, once', async () => {
    const org = (
      await admin.post('/api/v1/admin/organizations', {
        name: 'Cliente Uno',
        domains: ['clienteuno.mx'],
      })
    ).json();
    const email = uniqueEmail('nuevo');
    const inv = await agent.post('/api/v1/admin/invitations', {
      email,
      name: 'Nuevo',
      role: 'CUSTOMER',
      organizationId: org.id,
    });
    expect(inv.statusCode).toBe(201);
    expect(JSON.stringify(inv.json())).not.toMatch(/token/i);
    const token = tokenFromMail(t.mails, 'invitation', email);

    const portal = new Client(t.app, PORTAL);
    const inspect = await portal.post('/api/v1/auth/invitations/inspect', { token });
    expect(inspect.json()).toEqual({ email, name: 'Nuevo', organizationName: 'Cliente Uno' });
    expect(
      (
        await new Client(t.app, AGENT).post('/api/v1/auth/invitations/accept', {
          token,
          name: 'X',
          password: 'frase segura de prueba',
        })
      ).statusCode,
    ).toBe(400);

    const accept = await portal.post('/api/v1/auth/invitations/accept', {
      token,
      name: 'Nuevo Cliente',
      password: 'frase segura de prueba',
    });
    expect(accept.statusCode).toBe(204);
    expect(
      (
        await portal.post('/api/v1/auth/invitations/accept', {
          token,
          name: 'Otra',
          password: 'frase segura de prueba',
        })
      ).json().error.code,
    ).toBe('token_invalid');
    expect(
      (await new Client(t.app, PORTAL).login(email, 'frase segura de prueba')).json().state,
    ).toBe('authenticated');
  });

  it('applies invitation rules by role and organization', async () => {
    const customerOrg = await makeOrg(t.prisma);
    const base = { email: uniqueEmail('x'), name: 'X' };
    // Agents cannot invite staff: they do not even see the internal organization.
    expect(
      (
        await agent.post('/api/v1/admin/invitations', {
          ...base,
          role: 'AGENT',
          organizationId: internalOrgId,
        })
      ).statusCode,
    ).toBe(404);
    // Nobody can invite a customer into the internal organization (agents do not even see it).
    expect(
      (
        await agent.post('/api/v1/admin/invitations', {
          ...base,
          role: 'CUSTOMER',
          organizationId: internalOrgId,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await admin.post('/api/v1/admin/invitations', {
          ...base,
          role: 'CUSTOMER',
          organizationId: internalOrgId,
        })
      ).statusCode,
    ).toBe(403);
    // Nor staff into a customer organization.
    expect(
      (
        await admin.post('/api/v1/admin/invitations', {
          ...base,
          role: 'ADMIN',
          organizationId: customerOrg.id,
        })
      ).statusCode,
    ).toBe(403);
    // Unknown organization.
    expect(
      (
        await admin.post('/api/v1/admin/invitations', {
          ...base,
          role: 'CUSTOMER',
          organizationId: '00000000-0000-4000-8000-000000000000',
        })
      ).statusCode,
    ).toBe(404);
    // Admin invites staff into the internal organization.
    expect(
      (
        await admin.post('/api/v1/admin/invitations', {
          ...base,
          role: 'AGENT',
          organizationId: internalOrgId,
        })
      ).statusCode,
    ).toBe(201);
    // Mass assignment is rejected.
    expect(
      (
        await admin.post('/api/v1/admin/invitations', {
          ...base,
          role: 'CUSTOMER',
          organizationId: customerOrg.id,
          status: 'ACTIVE',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('revoked invitations stop working', async () => {
    const org = await makeOrg(t.prisma);
    const email = uniqueEmail('rev');
    const inv = await agent.post('/api/v1/admin/invitations', {
      email,
      name: 'R',
      role: 'CUSTOMER',
      organizationId: org.id,
    });
    const token = tokenFromMail(t.mails, 'invitation', email);
    expect((await agent.delete(`/api/v1/admin/invitations/${inv.json().id}`)).statusCode).toBe(204);
    expect(
      (await new Client(t.app, PORTAL).post('/api/v1/auth/invitations/inspect', { token }))
        .statusCode,
    ).toBe(400);
  });
});

describe('admin scopes', () => {
  it('agents see customers only; admins see everybody; customers cannot reach admin routes', async () => {
    const org = await makeOrg(t.prisma);
    const customer = await makeUser(t.prisma, 'CUSTOMER', org.id);
    const agentView = (await agent.get('/api/v1/admin/users?limit=100')).json();
    expect(agentView.items.every((u: { role: string }) => u.role === 'CUSTOMER')).toBe(true);
    expect(JSON.stringify(agentView)).not.toMatch(/passwordHash|totpSecret/);
    const orgs = (await agent.get('/api/v1/admin/organizations?limit=100')).json();
    expect(orgs.items.some((o: { isInternal: boolean }) => o.isInternal)).toBe(false);

    const adminView = (await admin.get('/api/v1/admin/users?limit=100')).json();
    expect(adminView.items.some((u: { role: string }) => u.role === 'ADMIN')).toBe(true);

    // Agents cannot create organizations, read the audit log or revoke sessions.
    expect((await agent.post('/api/v1/admin/organizations', { name: 'X' })).statusCode).toBe(403);
    expect((await agent.get('/api/v1/admin/audit-logs')).statusCode).toBe(403);
    expect(
      (await agent.post(`/api/v1/admin/users/${customer.id}/sessions/revoke`)).statusCode,
    ).toBe(403);
  });

  it('paginates with an opaque cursor and validates it', async () => {
    const page = (await admin.get('/api/v1/admin/users?limit=1')).json();
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const next = (await admin.get(`/api/v1/admin/users?limit=1&cursor=${page.nextCursor}`)).json();
    expect(next.items[0].id).not.toBe(page.items[0].id);
    expect((await admin.get('/api/v1/admin/users?cursor=../../etc')).statusCode).toBe(400);
  });

  it('lets admins end every session of a user', async () => {
    const org = await makeOrg(t.prisma);
    const customer = await makeUser(t.prisma, 'CUSTOMER', org.id);
    const c = new Client(t.app, PORTAL);
    await c.login(customer.email);
    const res = await admin.post(`/api/v1/admin/users/${customer.id}/sessions/revoke`);
    expect(res.json().revoked).toBe(1);
    expect((await c.get('/api/v1/auth/me')).statusCode).toBe(401);
  });
});

describe('audit trail', () => {
  it('records security events without secrets', async () => {
    const rows = await t.prisma.auditLog.findMany({
      where: {
        action: { in: ['auth.login.failed', 'auth.mfa.enabled', 'admin.invitation.created'] },
      },
    });
    expect(rows.length).toBeGreaterThan(0);
    const dump = JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(dump).not.toMatch(/frase segura|una frase de prueba|\$argon2/);
  });

  it('is append-only at the database level', async () => {
    await expect(t.prisma.$executeRaw`UPDATE audit_logs SET action = 'x'`).rejects.toThrow(
      /append-only/,
    );
    await expect(t.prisma.$executeRaw`DELETE FROM audit_logs`).rejects.toThrow(/append-only/);
    await expect(t.prisma.$executeRaw`TRUNCATE audit_logs`).rejects.toThrow(/append-only/);
  });

  it('verifies the hash chain through the admin API', async () => {
    const res = await admin.get('/api/v1/admin/audit-logs/verify');
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().checked).toBeGreaterThan(5);
    const list = (await admin.get('/api/v1/admin/audit-logs?limit=5')).json();
    expect(list.items).toHaveLength(5);
  });
});
