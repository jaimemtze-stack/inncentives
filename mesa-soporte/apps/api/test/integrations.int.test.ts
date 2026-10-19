import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/config';
import { DevOpsClient, type WorkItem } from '../src/integrations/devops.client';
import { DevOpsService } from '../src/integrations/devops.service';
import { JobsModule } from '../src/jobs/jobs.module';
import { WebhookCallerService } from '../src/jobs/webhook-caller.service';
import type { safePost } from '../src/jobs/safe-fetch';
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
let jobs: INestApplicationContext;
let agent: Client;
let admin: Client;
let customerId: string;
const items = new Map<number, WorkItem>();
let nextId = 100;

/** In-memory Azure DevOps standing in for dev.azure.com. */
function fakeClient(): DevOpsClient {
  return {
    create: async (type: string, title: string) => {
      const wi = {
        id: nextId++,
        title,
        state: 'New',
        type,
        url: `https://dev.azure.com/neitek/x/_workitems/edit/${nextId}`,
      };
      items.set(wi.id, wi);
      return wi;
    },
    get: async (id: number) => {
      const wi = items.get(id);
      if (!wi) throw new Error('Work item not found');
      return { ...wi };
    },
  } as unknown as DevOpsClient;
}

beforeAll(async () => {
  t = await startApp();
  jobs = await NestFactory.createApplicationContext(
    JobsModule.forRoot(loadConfig(), { runner: false }),
    { logger: false },
  );
  for (const svc of [t.app.get(DevOpsService), jobs.get(DevOpsService)])
    vi.spyOn(svc, 'client').mockImplementation(async () => fakeClient());
  const internal = await makeOrg(t.prisma, { internal: true });
  const org = await makeOrg(t.prisma);
  const a = await makeUser(t.prisma, 'AGENT', internal.id);
  const ad = await makeUser(t.prisma, 'ADMIN', internal.id);
  customerId = (await makeUser(t.prisma, 'CUSTOMER', org.id)).id;
  await grantGroup(t.prisma, a.id, GROUP_N1);
  agent = new Client(t.app, AGENT);
  admin = new Client(t.app, AGENT);
  await agent.loginAndEnroll(a.email);
  await admin.loginAndEnroll(ad.email);
});
afterAll(async () => {
  await jobs?.close();
  await t.close();
});

const newTicket = async () =>
  (
    await agent.post('/api/v1/tickets', {
      title: 'Error en cálculo',
      groupId: GROUP_N1,
      customerId,
      article: { type: 'phone', body: 'dato privado del cliente' },
    })
  ).json();

describe('Azure DevOps', () => {
  it('creates and links work items and notes state changes', async () => {
    const tk = await newTicket();
    const created = await agent.post(`/api/v1/tickets/${tk.id}/devops`, {
      description: 'Revisar fórmula',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ state: 'New', workItemType: 'Bug' });
    expect(created.json().title).toBe(`[#${tk.number}] Error en cálculo`);
    items.set(999, {
      id: 999,
      title: 'Existente',
      state: 'Active',
      type: 'Task',
      url: 'https://x',
    });
    expect(
      (await agent.post(`/api/v1/tickets/${tk.id}/devops/link`, { workItemId: 999 })).statusCode,
    ).toBe(201);
    expect((await agent.get(`/api/v1/tickets/${tk.id}/devops`)).json()).toHaveLength(2);

    items.get(created.json().workItemId)!.state = 'Resolved';
    expect(await jobs.get(DevOpsService).sync()).toBe(1);
    const notes = await t.prisma.article.findMany({
      where: { ticketId: tk.id, type: 'note', internal: true },
    });
    expect(notes.some((n) => n.bodyText.includes('"New" a "Resolved"'))).toBe(true);
  });

  it('accepts service hooks only with the shared secret and re-reads the state', async () => {
    process.env.SECRET_AZURE_DEVOPS_HOOK_SECRET = 'hook-secret-123';
    const hook = new Client(t.app, AGENT);
    const send = (auth?: string) =>
      hook.request(
        'POST',
        '/hooks/azure-devops',
        { resource: { workItemId: 999, fields: { 'System.State': 'Fake' } } },
        {
          origin: null,
          headers: auth ? { authorization: auth } : {},
        },
      );
    expect((await send()).statusCode).toBe(401);
    expect((await send(`Basic ${Buffer.from('x:wrong').toString('base64')}`)).statusCode).toBe(401);
    items.get(999)!.state = 'Closed';
    expect(
      (await send(`Basic ${Buffer.from('x:hook-secret-123').toString('base64')}`)).statusCode,
    ).toBe(204);
    const link = await t.prisma.devOpsLink.findFirstOrThrow({ where: { workItemId: 999 } });
    expect(link.state).toBe('Closed');
  });
});

describe('Microsoft Teams', () => {
  it('stores the webhook URL encrypted and sends metadata-only cards', async () => {
    await admin.post('/api/v1/auth/reauth', { password: PASSWORD });
    expect(
      (
        await admin.post('/api/v1/admin/config/teams-channels', {
          groupId: GROUP_N1,
          name: 'x',
          url: 'https://evil.example/x',
          events: ['ticket_created'],
        })
      ).statusCode,
    ).toBe(400);
    const ch = await admin.post('/api/v1/admin/config/teams-channels', {
      groupId: GROUP_N1,
      name: 'Soporte N1',
      url: 'https://neitek.webhook.office.com/webhookb2/abc',
      events: ['ticket_created', 'customer_reply'],
    });
    expect(ch.statusCode).toBe(201);
    expect(ch.json()).toMatchObject({ hasUrl: true });
    expect(JSON.stringify(ch.json())).not.toContain('webhook.office.com');

    const tk = await newTicket();
    const job = t.teams.find((j) => j.ticketId === tk.id && j.event === 'ticket_created');
    expect(job).toBeTruthy();
    const caller = jobs.get(WebhookCallerService);
    const posted: Array<{ url: string; body: string }> = [];
    (caller as unknown as { post: typeof safePost }).post = async (url, body) => {
      posted.push({ url, body });
      return { status: 200, body: '' };
    };
    await caller.callTeams(job!);
    expect(posted[0]!.url).toBe('https://neitek.webhook.office.com/webhookb2/abc');
    expect(posted[0]!.body).toContain(tk.number);
    expect(posted[0]!.body).not.toContain('dato privado');
    const deliveries = (
      await admin.get(`/api/v1/admin/webhook-deliveries?targetId=${ch.json().id}`)
    ).json();
    expect(deliveries[0]).toMatchObject({ kind: 'teams', status: 200, event: 'ticket_created' });
  });
});
