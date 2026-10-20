import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AGENT,
  Client,
  GROUP_N1,
  PASSWORD,
  grantGroup,
  makeOrg,
  makeUser,
  startApp,
  type TestApp,
} from './helpers';

let t: TestApp;
let admin: Client;
let agent: Client;
let adminId: string;
let agentId: string;
let customerId: string;
let internalId: string;
let clientOrgId: string;

beforeAll(async () => {
  t = await startApp();
  const internal = await makeOrg(t.prisma, { internal: true });
  const org = await makeOrg(t.prisma);
  [internalId, clientOrgId] = [internal.id, org.id];
  const a = await makeUser(t.prisma, 'ADMIN', internal.id);
  const g = await makeUser(t.prisma, 'AGENT', internal.id);
  const c = await makeUser(t.prisma, 'CUSTOMER', org.id);
  [adminId, agentId, customerId] = [a.id, g.id, c.id];
  await grantGroup(t.prisma, g.id, GROUP_N1);
  admin = new Client(t.app, AGENT);
  agent = new Client(t.app, AGENT);
  await admin.loginAndEnroll(a.email);
  await agent.loginAndEnroll(g.email);
});
afterAll(async () => t.close());

const reauth = (c: Client) => c.post('/api/v1/auth/reauth', { password: PASSWORD });

describe('user administration', () => {
  it('filters the user list; agents only see customers', async () => {
    const byRole = await admin.get('/api/v1/admin/users?limit=100&role=AGENT');
    const agents = byRole.json().items as Array<{ id: string; role: string }>;
    expect(agents.map((u) => u.id)).toContain(agentId);
    expect(agents.every((u) => u.role === 'AGENT')).toBe(true);
    const customer = await t.prisma.user.findUniqueOrThrow({ where: { id: customerId } });
    const byText = await admin.get(
      `/api/v1/admin/users?limit=100&q=${encodeURIComponent(customer.email.toUpperCase())}`,
    );
    expect(byText.json().items).toHaveLength(1);
    expect(byText.json().items[0].organization.id).toBe(clientOrgId);
    const seen = (await agent.get('/api/v1/admin/users?limit=100')).json().items;
    expect(seen.every((u: { role: string }) => u.role === 'CUSTOMER')).toBe(true);
  });

  it('changes roles within the organization rules and never for oneself', async () => {
    await reauth(admin);
    // A customer cannot become staff while staying in a client organization.
    const bad = await admin.patch(`/api/v1/admin/users/${customerId}`, { role: 'AGENT' });
    expect(bad.statusCode).toBe(400);
    await t.prisma.userSecondaryOrganization.create({
      data: { userId: customerId, organizationId: (await makeOrg(t.prisma)).id },
    });
    const ok = await admin.patch(`/api/v1/admin/users/${customerId}`, {
      role: 'AGENT',
      organizationId: internalId,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ role: 'AGENT', secondaryOrganizationIds: [] });
    expect(
      await t.prisma.auditLog.count({
        where: { action: 'admin.user.role_changed', targetId: customerId },
      }),
    ).toBe(1);

    // Back to customer: staff permissions do not survive.
    await grantGroup(t.prisma, customerId, GROUP_N1);
    const back = await admin.patch(`/api/v1/admin/users/${customerId}`, {
      role: 'CUSTOMER',
      organizationId: clientOrgId,
      orgTicketAccess: true,
    });
    expect(back.json()).toMatchObject({ role: 'CUSTOMER', groupAccess: [], orgTicketAccess: true });

    expect(
      (await admin.patch(`/api/v1/admin/users/${adminId}`, { role: 'AGENT' })).statusCode,
    ).toBe(403);
    // Promoting the agent ends their sessions: the new permissions start with a fresh sign-in.
    await admin.patch(`/api/v1/admin/users/${agentId}`, { role: 'ADMIN' });
    expect((await agent.get('/api/v1/admin/users?limit=1')).statusCode).toBe(401);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: agentId } })).role).toBe('ADMIN');
  });

  it('only administrators edit users', async () => {
    const c2 = await makeUser(t.prisma, 'AGENT', internalId);
    const other = new Client(t.app, AGENT);
    await other.loginAndEnroll(c2.email);
    await reauth(other);
    expect((await other.patch(`/api/v1/admin/users/${customerId}`, { name: 'X' })).statusCode).toBe(
      403,
    );
    expect((await other.post(`/api/v1/admin/users/${customerId}/mfa/reset`)).statusCode).toBe(403);
  });

  it('resets the second factor and signs the user out', async () => {
    const u = await makeUser(t.prisma, 'AGENT', internalId);
    const c = new Client(t.app, AGENT);
    await c.loginAndEnroll(u.email);
    expect((await admin.get(`/api/v1/admin/users/${u.id}`)).json().mfa.totp).toBe(true);

    await reauth(admin);
    expect((await admin.post(`/api/v1/admin/users/${adminId}/mfa/reset`)).statusCode).toBe(403);
    expect((await admin.post(`/api/v1/admin/users/${u.id}/mfa/reset`)).statusCode).toBe(204);

    const detail = (await admin.get(`/api/v1/admin/users/${u.id}`)).json();
    expect(detail).toMatchObject({ mfaEnabled: false, mfa: { totp: false, recoveryCodes: 0 } });
    expect((await c.get('/api/v1/auth/me')).statusCode).toBe(401);
    // Staff must set up a new factor at the next sign-in.
    const again = new Client(t.app, AGENT);
    const login = await again.post('/api/v1/auth/login', { email: u.email, password: PASSWORD });
    expect(login.json().state).toBe('mfa_enrollment_required');
    expect(
      await t.prisma.auditLog.count({ where: { action: 'admin.user.mfa_reset', targetId: u.id } }),
    ).toBe(1);
  });

  it('lists and resends pending invitations', async () => {
    const inv = await admin.post('/api/v1/admin/invitations', {
      email: 'nuevo.cliente@example.com',
      name: 'Nuevo Cliente',
      role: 'CUSTOMER',
      organizationId: clientOrgId,
    });
    expect(inv.statusCode).toBe(201);
    const list = (await admin.get('/api/v1/admin/invitations')).json();
    expect(list.map((i: { id: string }) => i.id)).toContain(inv.json().id);

    const again = await admin.post(`/api/v1/admin/invitations/${inv.json().id}/resend`);
    expect(again.statusCode).toBe(201);
    expect(again.json().id).not.toBe(inv.json().id);
    const old = await t.prisma.invitation.findUniqueOrThrow({ where: { id: inv.json().id } });
    expect(old.revokedAt).not.toBeNull();
    const after = (await admin.get('/api/v1/admin/invitations')).json();
    expect(after.map((i: { id: string }) => i.id)).toEqual(
      expect.arrayContaining([again.json().id]),
    );
    expect(after.map((i: { id: string }) => i.id)).not.toContain(inv.json().id);
    expect((await admin.post(`/api/v1/admin/invitations/${inv.json().id}/resend`)).statusCode).toBe(
      404,
    );
  });
});
