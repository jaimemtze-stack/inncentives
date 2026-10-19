import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AGENT,
  Client,
  GROUP_N1,
  PORTAL,
  grantGroup,
  makeOrg,
  makeUser,
  startApp,
  type TestApp,
} from './helpers';

let t: TestApp;
let agent: Client;
let customer: Client;
let orgName: string;
let customerId: string;

beforeAll(async () => {
  t = await startApp();
  const internal = await makeOrg(t.prisma, { internal: true });
  const org = await t.prisma.organization.create({ data: { name: 'Buscable Industrial SA' } });
  orgName = org.name;
  const a = await makeUser(t.prisma, 'AGENT', internal.id);
  const c = await makeUser(t.prisma, 'CUSTOMER', org.id);
  customerId = c.id;
  await t.prisma.user.update({ where: { id: c.id }, data: { name: 'Buscable Cliente' } });
  await grantGroup(t.prisma, a.id, GROUP_N1);
  agent = new Client(t.app, AGENT);
  customer = new Client(t.app, PORTAL);
  await agent.loginAndEnroll(a.email);
  await customer.login(c.email);
});
afterAll(async () => t.close());

const ids = (r: { tickets: Array<{ id: string }> }) => r.tickets.map((x) => x.id);

describe('global search', () => {
  it('combines filters with text and only shows users and organizations to staff', async () => {
    const mine = (
      await agent.post('/api/v1/tickets', {
        title: 'Buscable error de liquidación',
        groupId: GROUP_N1,
        customerId,
        article: { type: 'phone', body: 'detalle' },
      })
    ).json();
    const me = (await agent.get('/api/v1/auth/me')).json().user.id;
    expect((await agent.patch(`/api/v1/tickets/${mine.id}`, { ownerId: me })).statusCode).toBe(200);
    await agent.post(`/api/v1/tickets/${mine.id}/tags`, { tags: ['calculo'] });
    const other = (
      await agent.post('/api/v1/tickets', {
        title: 'Buscable otra consulta',
        groupId: GROUP_N1,
        customerId,
        article: { type: 'phone', body: 'detalle' },
      })
    ).json();

    const q = (s: string, c = agent) =>
      c.get(`/api/v1/search/global?q=${encodeURIComponent(s)}`).then((r) => r.json());
    expect(ids(await q('buscable owner:me'))).toEqual([mine.id]);
    expect(ids(await q('tag:calculo'))).toEqual([mine.id]);
    expect(ids(await q(`org:"${orgName}" state:open`)).sort()).toEqual([mine.id, other.id].sort());
    expect(ids(await q('org:"No Existe" buscable'))).toEqual([]);
    expect(ids(await q(`#${other.number}`))).toEqual([other.id]);

    const staff = await q('Buscable');
    expect(staff.users.map((u: { id: string }) => u.id)).toContain(customerId);
    expect(staff.organizations.map((o: { name: string }) => o.name)).toContain(orgName);

    const cust = await q('Buscable', customer);
    expect(cust.users).toEqual([]);
    expect(cust.organizations).toEqual([]);
    expect(ids(cust).sort()).toEqual([mine.id, other.id].sort());
  });
});
