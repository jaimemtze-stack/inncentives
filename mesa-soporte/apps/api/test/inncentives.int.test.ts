import { SignJWT } from 'jose';
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

const SECRET = 'w'.repeat(40);
let t: TestApp;
let admin: Client;
let agent: Client;
let customer: Client;
let other: Client;
let orgId: string;
let customerId: string;

const sign = (claims: Record<string, unknown>, opts: { secret?: string; aud?: string } = {}) =>
  new SignJWT({
    tenant: 'acme',
    environment: { id: 'acme-prod', name: 'Producción', kind: 'production' },
    module: 'calculo',
    url: 'https://acme.inncentives.example/calculo/123',
    version: '2026.9.2',
    email: 'ana@acme.example',
    ...claims,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('inncentives')
    .setAudience(opts.aud ?? 'mesa-soporte')
    .setIssuedAt()
    .setExpirationTime('10m')
    .setJti(Math.random().toString(36).slice(2) + 'abcdefgh')
    .sign(new TextEncoder().encode(opts.secret ?? SECRET));

beforeAll(async () => {
  process.env.SECRET_INNCENTIVES_WIDGET_SECRET = SECRET;
  t = await startApp();
  await t.prisma.appSetting.upsert({
    where: { key: 'inncentives' },
    create: {
      key: 'inncentives',
      value: {
        mode: 'mock',
        baseUrl: '',
        secretName: 'inncentives_api_token',
        widgetSecretName: 'inncentives_widget_secret',
        widgetIssuer: 'inncentives',
      },
    },
    update: {},
  });
  const internal = await makeOrg(t.prisma, { internal: true });
  const org = await makeOrg(t.prisma);
  orgId = org.id;
  const a = await makeUser(t.prisma, 'AGENT', internal.id);
  await grantGroup(t.prisma, a.id, GROUP_N1);
  const c = await makeUser(t.prisma, 'CUSTOMER', org.id);
  customerId = c.id;
  admin = new Client(t.app, AGENT);
  agent = new Client(t.app, AGENT);
  customer = new Client(t.app, PORTAL);
  other = new Client(t.app, PORTAL);
  await admin.loginAndEnroll((await makeUser(t.prisma, 'ADMIN', internal.id)).email);
  await agent.loginAndEnroll(a.email);
  await customer.login(c.email);
  await other.login((await makeUser(t.prisma, 'CUSTOMER', (await makeOrg(t.prisma)).id)).email);
});
afterAll(async () => t.close());

describe('Inncentives integration', () => {
  it('links the tenant key and shows the sidebar to agents only', async () => {
    expect(
      (await agent.patch(`/api/v1/admin/organizations/${orgId}`, { aiEnabled: true })).statusCode,
    ).toBe(403);
    await admin.post('/api/v1/auth/reauth', { password: PASSWORD });
    const upd = await admin.patch(`/api/v1/admin/organizations/${orgId}`, {
      inncentivesTenantKey: 'acme',
    });
    expect(upd.statusCode).toBe(200);
    const tk = (
      await agent.post('/api/v1/tickets', {
        title: 'Duda',
        groupId: GROUP_N1,
        customerId,
        article: { type: 'phone', body: 'x' },
      })
    ).json();
    const side = (await agent.get(`/api/v1/tickets/${tk.id}/inncentives`)).json();
    expect(side.available).toBe(true);
    expect(side.environments.map((e: { kind: string }) => e.kind)).toEqual(['production', 'test']);
    expect(side.environments[0].failedRuns.length).toBeGreaterThan(0);
    expect((await customer.get(`/api/v1/tickets/${tk.id}/inncentives`)).statusCode).toBe(421);
  });

  it('creates a ticket from a verified widget context, once', async () => {
    const token = await sign({});
    const ctx = await customer.post('/api/v1/widget/context', { token });
    expect(ctx.statusCode).toBe(201);
    expect(ctx.json()).toMatchObject({ module: 'calculo', version: '2026.9.2' });

    // Another customer, a forged signature or another audience are refused.
    expect((await other.post('/api/v1/widget/context', { token })).statusCode).toBe(403);
    expect(
      (
        await customer.post('/api/v1/widget/context', {
          token: await sign({}, { secret: 'x'.repeat(40) }),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await customer.post('/api/v1/widget/context', { token: await sign({}, { aud: 'other' }) }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await customer.post('/api/v1/widget/context', {
          token: await sign({ url: 'javascript:alert(1)' }),
        })
      ).statusCode,
    ).toBe(400);

    const res = await customer.post('/api/v1/widget/tickets', {
      token,
      title: 'Error al calcular',
      body: '<p>El proceso falló</p>',
    });
    expect(res.statusCode).toBe(201);
    const ticket = await t.prisma.ticket.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(ticket.channel).toBe('widget');
    expect(ticket.customFields).toMatchObject({
      inncentives_environment: 'prod',
      inncentives_module: 'otro',
      inncentives_version: '2026.9.2',
    });
    const note = await t.prisma.article.findFirst({
      where: { ticketId: ticket.id, internal: true },
    });
    expect(note?.bodyText).toContain('acme.inncentives.example/calculo/123');
    // The customer never sees the internal context note.
    const arts = (await customer.get(`/api/v1/tickets/${ticket.id}/articles`)).json();
    expect(arts.some((a: { type: string }) => a.type === 'note')).toBe(false);
    expect(
      (await customer.post('/api/v1/widget/tickets', { token, title: 'Otra', body: 'x' }))
        .statusCode,
    ).toBe(409);
    expect((await agent.post('/api/v1/widget/context', { token })).statusCode).toBe(421);
  });
});
