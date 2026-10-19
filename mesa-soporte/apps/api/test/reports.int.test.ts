import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zipEntries } from '../src/privacy/zip';
import {
  AGENT,
  Client,
  GROUP_N1,
  GROUP_N2,
  PORTAL,
  grantGroup,
  makeOrg,
  makeUser,
  startApp,
  type TestApp,
} from './helpers';

let t: TestApp;
let agent: Client;
let outsider: Client;
let customer: Client;
let customerId: string;
let orgId: string;

beforeAll(async () => {
  t = await startApp();
  const internal = await makeOrg(t.prisma, { internal: true });
  const org = await makeOrg(t.prisma);
  const a = await makeUser(t.prisma, 'AGENT', internal.id);
  const o = await makeUser(t.prisma, 'AGENT', internal.id);
  const c = await makeUser(t.prisma, 'CUSTOMER', org.id);
  customerId = c.id;
  orgId = org.id;
  await grantGroup(t.prisma, a.id, GROUP_N1);
  await grantGroup(t.prisma, o.id, GROUP_N2);
  agent = new Client(t.app, AGENT);
  outsider = new Client(t.app, AGENT);
  customer = new Client(t.app, PORTAL);
  await agent.loginAndEnroll(a.email);
  await outsider.loginAndEnroll(o.email);
  await customer.login(c.email);
});
afterAll(async () => t.close());

const period = () => {
  const from = new Date(Date.now() - 86_400_000).toISOString();
  const to = new Date(Date.now() + 86_400_000).toISOString();
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
};

describe('reports', () => {
  it('computes metrics only over tickets the agent can read', async () => {
    const tk = (
      await agent.post('/api/v1/tickets', {
        title: '=HYPERLINK("http://evil","x")',
        groupId: GROUP_N1,
        customerId,
        customFields: { inncentives_module: 'reportes', category: 'calculo' },
        article: { type: 'phone', body: 'x' },
      })
    ).json();
    await agent.post(`/api/v1/tickets/${tk.id}/articles`, { type: 'email', body: 'respuesta' });
    await agent.post(`/api/v1/tickets/${tk.id}/time-entries`, { minutes: 45 });
    await agent.patch(`/api/v1/tickets/${tk.id}`, { state: 'closed' });
    await agent.patch(`/api/v1/tickets/${tk.id}`, { state: 'open' });

    const r = (await agent.get(`/api/v1/reports/summary?${period()}`)).json();
    expect(r.totals.created).toBeGreaterThanOrEqual(1);
    expect(r.totals.reopened).toBeGreaterThanOrEqual(1);
    expect(r.firstResponseMinutes.count).toBeGreaterThanOrEqual(1);
    expect(r.topModules).toContainEqual({ key: 'reportes', count: 1 });
    expect(r.timeByOrganization[0].minutes).toBeGreaterThanOrEqual(45);
    // The database is shared with other test files: look only at this customer's organization.
    const other = (
      await outsider.get(`/api/v1/reports/summary?${period()}&organizationId=${orgId}`)
    ).json();
    expect(other.totals.created).toBe(0);
    expect((await customer.get(`/api/v1/reports/summary?${period()}`)).statusCode).toBe(421);
    expect(
      (await agent.get('/api/v1/reports/summary?from=2026-01-01&to=2028-01-01')).statusCode,
    ).toBe(400);
  });

  it('exports CSV and XLSX without live formulas and audits it', async () => {
    const csv = await agent.request('GET', `/api/v1/reports/export?${period()}&format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    const text = String((csv as unknown as { json: () => string }).json());
    expect(text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    const xlsx = await t.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/v1/reports/export?${period()}&format=xlsx`,
        headers: { host: AGENT, cookie: `__Host-sid=${agent.cookie}` },
      });
    expect(xlsx.statusCode).toBe(200);
    expect(zipEntries(xlsx.rawPayload).map((e) => e.name)).toContain('xl/worksheets/sheet1.xml');
    expect(await t.prisma.auditLog.count({ where: { action: 'report.exported' } })).toBe(2);
  });
});
