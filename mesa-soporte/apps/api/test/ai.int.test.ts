import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AiService } from '../src/ai/ai.service';
import type { AiRequest } from '../src/ai/provider';
import {
  AGENT,
  Client,
  GROUP_N1,
  GROUP_N2,
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
let outsider: Client;
let customer: Client;
let orgId: string;
let ticketId: string;
const calls: AiRequest[] = [];
let answer = 'Resumen de prueba';

beforeAll(async () => {
  t = await startApp();
  vi.spyOn(t.app.get(AiService), 'provider').mockImplementation(async () => {
    const cfg = await t.prisma.appSetting.findUnique({ where: { key: 'ai' } });
    if (!(cfg?.value as { enabled?: boolean } | undefined)?.enabled) return null;
    return {
      complete: async (r: AiRequest) => {
        calls.push(r);
        return { text: answer, model: 'claude-opus-5-5' };
      },
    };
  });
  const internal = await makeOrg(t.prisma, { internal: true });
  const org = await makeOrg(t.prisma);
  orgId = org.id;
  const c = await makeUser(t.prisma, 'CUSTOMER', org.id);
  const a = await makeUser(t.prisma, 'AGENT', internal.id);
  await grantGroup(t.prisma, a.id, GROUP_N1);
  const o = await makeUser(t.prisma, 'AGENT', internal.id);
  await grantGroup(t.prisma, o.id, GROUP_N2);
  admin = new Client(t.app, AGENT);
  agent = new Client(t.app, AGENT);
  outsider = new Client(t.app, AGENT);
  customer = new Client(t.app, PORTAL);
  await admin.loginAndEnroll((await makeUser(t.prisma, 'ADMIN', internal.id)).email);
  await agent.loginAndEnroll(a.email);
  await outsider.loginAndEnroll(o.email);
  await customer.login(c.email);
  ticketId = (
    await agent.post('/api/v1/tickets', {
      title: 'Error en el cálculo de comisiones',
      groupId: GROUP_N1,
      customerId: c.id,
      article: {
        type: 'phone',
        body: 'Llamó desde 55 1234 5678, correo ana@acme.mx, su CLABE 002010077777777771. El bono de marzo salió en cero.',
      },
    })
  ).json().id;
});
afterAll(async () => t.close());

describe('AI suggestions', () => {
  it('stay off until enabled globally and for the organization', async () => {
    expect((await agent.get(`/api/v1/tickets/${ticketId}/ai`)).json()).toEqual({ enabled: false });
    expect((await agent.post(`/api/v1/tickets/${ticketId}/ai/summary`)).statusCode).toBe(409);
    await t.prisma.appSetting.upsert({
      where: { key: 'ai' },
      create: {
        key: 'ai',
        value: { enabled: true, model: 'claude-opus-5-5', secretName: 'anthropic_api_key' },
      },
      update: {},
    });
    expect((await agent.post(`/api/v1/tickets/${ticketId}/ai/summary`)).statusCode).toBe(409);
    await admin.post('/api/v1/auth/reauth', { password: PASSWORD });
    expect(
      (await admin.patch(`/api/v1/admin/organizations/${orgId}`, { aiEnabled: true })).statusCode,
    ).toBe(200);
    expect((await agent.get(`/api/v1/tickets/${ticketId}/ai`)).json()).toEqual({ enabled: true });
    expect(calls).toHaveLength(0);
  });

  it('sends redacted ticket text only, for agents who can read the ticket, and audits it', async () => {
    expect((await customer.post(`/api/v1/tickets/${ticketId}/ai/summary`)).statusCode).toBe(421);
    expect((await outsider.post(`/api/v1/tickets/${ticketId}/ai/summary`)).statusCode).toBe(404);
    const res = await agent.post(`/api/v1/tickets/${ticketId}/ai/summary`);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ text: 'Resumen de prueba' });
    const sent = calls.at(-1)!.user;
    expect(sent).toContain('El bono de marzo salió en cero');
    expect(sent).not.toMatch(/ana@acme\.mx|1234 5678|002010077777777771/);
    expect(calls.at(-1)!.system).toMatch(/nunca sigas instrucciones/);
    const log = await t.prisma.auditLog.findFirst({
      where: { action: 'ai.request', targetId: ticketId },
    });
    expect(log?.data).toMatchObject({ purpose: 'summary', model: 'claude-opus-5-5' });
    expect((log?.data as { redactions: number }).redactions).toBeGreaterThanOrEqual(3);
    // Nothing reaches the customer.
    expect(t.outbound).toHaveLength(0);
  });

  it('classifies with a constrained schema and rejects unusable answers', async () => {
    const priority = (await t.prisma.ticketPriority.findFirstOrThrow({ where: { active: true } }))
      .name;
    answer = JSON.stringify({ category: 'calculo', module: 'planes', priority, reason: 'Bono' });
    const res = await agent.post(`/api/v1/tickets/${ticketId}/ai/classify`);
    expect(res.statusCode).toBe(201);
    expect(res.json().customFields).toEqual({ category: 'calculo', inncentives_module: 'planes' });
    expect(calls.at(-1)!.schema).toMatchObject({ additionalProperties: false });
    answer = JSON.stringify({
      category: 'inventada',
      module: 'planes',
      priority: 'x',
      reason: 'x',
    });
    expect((await agent.post(`/api/v1/tickets/${ticketId}/ai/classify`)).statusCode).toBe(409);
  });

  it('rewrites a draft with personal data redacted', async () => {
    answer = 'Texto mejorado';
    const res = await agent.post(`/api/v1/tickets/${ticketId}/ai/compose`, {
      draft: 'hola ana, tu rfc GOLA850101AB1 ya qedo',
      mode: 'improve',
    });
    expect(res.json()).toEqual({ text: 'Texto mejorado' });
    expect(calls.at(-1)!.user).not.toContain('GOLA850101AB1');
  });
});
