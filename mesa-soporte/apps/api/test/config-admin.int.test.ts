import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AGENT,
  Client,
  GROUP_N1,
  PASSWORD,
  PORTAL,
  grantGroup,
  makeOrg,
  makeUser,
  startApp,
  type TestApp,
} from './helpers';

let t: TestApp;
let admin: Client;
let agent: Client;
let agentId: string;
let customerId: string;

beforeAll(async () => {
  t = await startApp();
  const internal = await makeOrg(t.prisma, { internal: true });
  const org = await makeOrg(t.prisma);
  const a = await makeUser(t.prisma, 'ADMIN', internal.id);
  const g = await makeUser(t.prisma, 'AGENT', internal.id);
  const c = await makeUser(t.prisma, 'CUSTOMER', org.id);
  [agentId, customerId] = [g.id, c.id];
  await grantGroup(t.prisma, g.id, GROUP_N1);
  admin = new Client(t.app, AGENT);
  agent = new Client(t.app, AGENT);
  await admin.loginAndEnroll(a.email);
  await agent.loginAndEnroll(g.email);
});
afterAll(async () => t.close());

const reauth = (c: Client) => c.post('/api/v1/auth/reauth', { password: PASSWORD });

describe('configuration admin', () => {
  it('is admin-only and validates rules against the field catalogue', async () => {
    expect((await agent.get('/api/v1/admin/config/triggers')).statusCode).toBe(403);
    expect((await admin.get('/api/v1/admin/config/nope')).statusCode).toBe(404);
    const bad = await admin.post('/api/v1/admin/config/triggers', {
      name: 'Malo',
      event: 'create',
      conditions: {
        op: 'and',
        conditions: [{ field: 'ticket.password', operator: 'is', value: 'x' }],
      },
      actions: [{ type: 'add_tags', tags: ['x'] }],
    });
    expect(bad.statusCode).toBe(400);
    const loop = await admin.post('/api/v1/admin/config/triggers', {
      name: 'Reabrir',
      event: 'update',
      conditions: {
        op: 'and',
        conditions: [{ field: 'ticket.state', operator: 'changed_to', value: 'pending_reminder' }],
      },
      actions: [{ type: 'set', field: 'state', value: 'open' }],
    });
    expect(loop.statusCode).toBe(201);
    expect(loop.json().warnings).toEqual(['loop_risk:state']);
    const upd = await admin.patch(`/api/v1/admin/config/triggers/${loop.json().id}`, {
      active: false,
    });
    expect(upd.json().active).toBe(false);
    expect((await admin.delete(`/api/v1/admin/config/triggers/${loop.json().id}`)).statusCode).toBe(
      204,
    );
    expect(
      await t.prisma.auditLog.count({ where: { action: { startsWith: 'config.triggers.' } } }),
    ).toBe(3);
  });

  it('manages SLAs with targets, protects system rows and hides webhook secrets', async () => {
    const prios = await t.prisma.ticketPriority.findMany();
    const sla = await admin.post('/api/v1/admin/config/slas', {
      name: 'Premium',
      conditions: { op: 'and', conditions: [] },
      calendarId: '00000000-0000-4000-8000-000000000201',
      targets: prios.map((p) => ({
        priorityId: p.id,
        firstResponseMinutes: 30,
        updateMinutes: 60,
        solutionMinutes: 240,
      })),
    });
    expect(sla.statusCode).toBe(201);
    expect(await t.prisma.slaTarget.count({ where: { slaId: sla.json().id } })).toBe(prios.length);
    await admin.delete(`/api/v1/admin/config/slas/${sla.json().id}`);
    expect(
      (await admin.delete('/api/v1/admin/config/groups/00000000-0000-4000-8000-000000000304'))
        .statusCode,
    ).toBe(403);
    await agent.post('/api/v1/tickets', {
      title: 'En uso',
      groupId: GROUP_N1,
      customerId,
      article: { type: 'note', body: 'x' },
    });
    expect((await admin.delete(`/api/v1/admin/config/groups/${GROUP_N1}`)).statusCode).toBe(409);

    expect(
      (await admin.post('/api/v1/admin/config/webhooks', { name: 'x', url: 'http://x.mx/h' }))
        .statusCode,
    ).toBe(400);
    const hook = await admin.post('/api/v1/admin/config/webhooks', {
      name: 'Teams',
      url: 'https://hooks.example.com/abc',
      secret: 'un-secreto-muy-largo-123',
    });
    expect(hook.json()).toMatchObject({ hasSecret: true });
    expect(JSON.stringify(hook.json())).not.toMatch(/secret(Enc)?"\s*:\s*"/);
    const list = (await admin.get('/api/v1/admin/config/webhooks')).json();
    expect(JSON.stringify(list)).not.toContain('v1:');
  });

  it('updates settings with validation and audit', async () => {
    expect(
      (await admin.put('/api/v1/admin/settings', { ticket_hook: 'Ticket#\r\n' })).statusCode,
    ).toBe(400);
    const res = await admin.put('/api/v1/admin/settings', { auto_reply_limit_per_hour: 3 });
    expect(res.json().auto_reply_limit_per_hour).toBe(3);
    expect(
      await t.prisma.auditLog.findFirst({ where: { action: 'config.settings.updated' } }),
    ).toBeTruthy();
  });

  it('changes group access and roles (re-authenticated, audited)', async () => {
    const body = [{ groupId: GROUP_N1, levels: ['read'] }];
    await reauth(admin);
    const res = await admin.put(`/api/v1/admin/users/${agentId}/group-access`, body);
    expect(res.json().groupAccess).toEqual(body);
    const role = await admin.post('/api/v1/admin/config/custom-roles', {
      name: 'Configurador',
      permissions: ['admin.config'],
    });
    await admin.patch(`/api/v1/admin/users/${agentId}`, {
      customRoleIds: [role.json().id],
      phone: '55 1234 9999',
    });
    expect((await agent.get('/api/v1/admin/config/macros')).statusCode).toBe(200);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: agentId } })).phone).toBe(
      '+525512349999',
    );
    expect(
      (
        await admin.post('/api/v1/admin/config/custom-roles', {
          name: 'Cliente',
          permissions: ['tickets.customer'],
        })
      ).statusCode,
    ).toBe(400);
    await admin.put(`/api/v1/admin/users/${agentId}/group-access`, [
      { groupId: GROUP_N1, levels: ['full'] },
    ]);
    expect(
      await t.prisma.auditLog.count({
        where: { action: 'admin.user.group_access_changed', targetId: agentId },
      }),
    ).toBe(2);
  });
});

describe('API tokens', () => {
  it('issues scoped tokens once, accepts them on the agents host only and revokes them', async () => {
    await reauth(agent);
    expect(
      (
        await agent.post('/api/v1/me/api-tokens', {
          name: 'x',
          scopes: ['admin.audit.read'],
          expiresInDays: 30,
        })
      ).statusCode,
    ).toBe(400);
    const created = (
      await agent.post('/api/v1/me/api-tokens', {
        name: 'ci',
        scopes: ['tickets.agent'],
        expiresInDays: 30,
      })
    ).json();
    expect(created.token).toMatch(/^mesa_/);
    expect(JSON.stringify((await agent.get('/api/v1/me/api-tokens')).json())).not.toContain(
      created.token,
    );

    const bot = new Client(t.app, AGENT);
    const auth = { headers: { authorization: `Bearer ${created.token}` }, origin: null };
    expect((await bot.request('GET', '/api/v1/overviews', undefined, auth)).statusCode).toBe(200);
    const write = await bot.request(
      'POST',
      '/api/v1/tickets',
      {
        title: 'Desde API',
        groupId: GROUP_N1,
        customerId,
        article: { type: 'note', body: 'x' },
      },
      auth,
    );
    expect(write.statusCode).toBe(201);
    // Scopes narrow: macros admin is not in the token even though the user has it via a role.
    expect(
      (await bot.request('GET', '/api/v1/admin/config/macros', undefined, auth)).statusCode,
    ).toBe(403);
    expect(
      (await new Client(t.app, PORTAL).request('GET', '/api/v1/overviews', undefined, auth))
        .statusCode,
    ).toBe(401);
    expect((await agent.delete(`/api/v1/me/api-tokens/${created.id}`)).statusCode).toBe(204);
    expect((await bot.request('GET', '/api/v1/overviews', undefined, auth)).statusCode).toBe(401);
  });
});

describe('view as customer and privacy tasks', () => {
  it('lets admins view a customer portal read-only for a limited time', async () => {
    await reauth(admin);
    const tk = (
      await agent.post('/api/v1/tickets', {
        title: 'Visible',
        groupId: GROUP_N1,
        customerId,
        article: { type: 'phone', body: 'público' },
      })
    ).json();
    await agent.post(`/api/v1/tickets/${tk.id}/articles`, {
      type: 'note',
      internal: true,
      body: 'interno',
    });
    const start = await admin.post('/api/v1/admin/view-as', {
      userId: customerId,
      reason: 'Revisar reporte del cliente',
    });
    expect(start.statusCode).toBe(201);
    const sid = start.json().sid;
    const view = (await admin.get(`/api/v1/admin/view-as/${sid}/tickets/${tk.id}`)).json();
    expect(view.articles.map((a: { bodyHtml: string }) => a.bodyHtml).join()).not.toContain(
      'interno',
    );
    expect(view.ticket).not.toHaveProperty('slaId');
    expect((await agent.get(`/api/v1/admin/view-as/${sid}/tickets`)).statusCode).toBe(403);
    expect(
      await t.prisma.auditLog.findFirst({
        where: { action: 'admin.view_as.started', targetId: customerId },
      }),
    ).toBeTruthy();
  });

  it('queues audited privacy tasks', async () => {
    const res = await admin.post('/api/v1/admin/privacy-tasks', {
      userId: customerId,
      action: 'export',
      reason: 'Solicitud ARCO 1',
    });
    expect(res.statusCode).toBe(201);
    expect(
      (
        await admin.post('/api/v1/admin/privacy-tasks', {
          userId: agentId,
          action: 'delete',
          reason: 'no permitido',
        })
      ).statusCode,
    ).toBe(400);
    expect((await admin.get('/api/v1/admin/privacy-tasks')).json()[0]).toMatchObject({
      action: 'export',
      status: 'pending',
    });
  });
});
