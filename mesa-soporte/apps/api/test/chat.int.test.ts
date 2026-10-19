import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatService } from '../src/chat/chat.service';
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
let agent2: Client;
let outsider: Client;
let customer: Client;
let customer2: Client;

beforeAll(async () => {
  t = await startApp();
  await t.prisma.appSetting.upsert({
    where: { key: 'chat' },
    create: { key: 'chat', value: { enabled: true, groupId: GROUP_N1, idleMinutes: 15 } },
    update: { value: { enabled: true, groupId: GROUP_N1, idleMinutes: 15 } },
  });
  const internal = await makeOrg(t.prisma, { internal: true });
  const org = await makeOrg(t.prisma);
  const clients: Client[] = [];
  for (const g of [GROUP_N1, GROUP_N1, GROUP_N2]) {
    const u = await makeUser(t.prisma, 'AGENT', internal.id);
    await grantGroup(t.prisma, u.id, g);
    const c = new Client(t.app, AGENT);
    await c.loginAndEnroll(u.email);
    clients.push(c);
  }
  [agent, agent2, outsider] = clients as [Client, Client, Client];
  customer = new Client(t.app, PORTAL);
  customer2 = new Client(t.app, PORTAL);
  await customer.login((await makeUser(t.prisma, 'CUSTOMER', org.id)).email);
  await customer2.login((await makeUser(t.prisma, 'CUSTOMER', org.id)).email);
});
afterAll(async () => t.close());

describe('live chat', () => {
  let sessionId: string;
  let ticketId: string;

  it('opens only when an agent of the chat group is available', async () => {
    expect((await customer.get('/api/v1/chat/status')).json()).toMatchObject({
      enabled: true,
      available: false,
      session: null,
    });
    expect((await customer.post('/api/v1/chat/sessions', { message: 'Hola' })).statusCode).toBe(
      409,
    );
    expect((await outsider.post('/api/v1/chat/availability', { available: true })).statusCode).toBe(
      403,
    );
    expect((await agent.post('/api/v1/chat/availability', { available: true })).statusCode).toBe(
      201,
    );
    expect((await customer.get('/api/v1/chat/status')).json().available).toBe(true);

    const res = await customer.post('/api/v1/chat/sessions', { message: 'No veo mi liquidación' });
    expect(res.statusCode).toBe(201);
    ({ id: sessionId, ticketId } = res.json());
    expect(res.json().state).toBe('waiting');
    expect((await customer.post('/api/v1/chat/sessions', { message: 'Otra' })).statusCode).toBe(
      409,
    );
    expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).channel).toBe(
      'chat',
    );
  });

  it('lets exactly one agent take the chat and keeps it private', async () => {
    const queue = (await agent.get('/api/v1/chat/queue')).json();
    expect(queue.map((q: { id: string }) => q.id)).toContain(sessionId);
    expect((await outsider.get('/api/v1/chat/queue')).statusCode).toBe(403);
    expect(
      (await agent.post(`/api/v1/chat/sessions/${sessionId}/messages`, { body: 'x' })).statusCode,
    ).toBe(404);
    expect(
      (await customer2.post(`/api/v1/chat/sessions/${sessionId}/messages`, { body: 'x' }))
        .statusCode,
    ).toBe(404);

    expect((await agent.post(`/api/v1/chat/sessions/${sessionId}/accept`)).statusCode).toBe(201);
    expect((await agent2.post(`/api/v1/chat/sessions/${sessionId}/accept`)).statusCode).toBe(409);
    expect(
      (await agent2.post(`/api/v1/chat/sessions/${sessionId}/messages`, { body: 'x' })).statusCode,
    ).toBe(404);

    await agent.post(`/api/v1/chat/sessions/${sessionId}/messages`, { body: 'Hola, te ayudo' });
    await customer.post(`/api/v1/chat/sessions/${sessionId}/messages`, { body: 'Gracias' });
    const arts = (await customer.get(`/api/v1/tickets/${ticketId}/articles`)).json();
    expect(arts.filter((a: { type: string }) => a.type === 'chat')).toHaveLength(3);
    const tk = await t.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(tk.ownerId).toBeTruthy();
    expect(tk.firstResponseAt).toBeTruthy();
  });

  it('closes the ticket when an answered chat ends', async () => {
    expect((await customer.post(`/api/v1/chat/sessions/${sessionId}/end`)).statusCode).toBe(201);
    expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).state).toBe(
      'closed',
    );
    expect(
      (await customer.post(`/api/v1/chat/sessions/${sessionId}/messages`, { body: 'x' }))
        .statusCode,
    ).toBe(409);
    const arts = (await customer.get(`/api/v1/tickets/${ticketId}/articles`)).json();
    expect(arts.some((a: { type: string }) => a.type === 'note')).toBe(false);
  });

  it('ends idle chats and keeps unanswered ones as open tickets', async () => {
    const res = (
      await customer2.post('/api/v1/chat/sessions', { message: 'Nadie contesta' })
    ).json();
    await t.prisma.chatSession.update({
      where: { id: res.id },
      data: { lastActivityAt: new Date(Date.now() - 60 * 60_000) },
    });
    expect(await t.app.get(ChatService).closeIdle()).toBe(1);
    expect((await t.prisma.chatSession.findUniqueOrThrow({ where: { id: res.id } })).state).toBe(
      'ended',
    );
    expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id: res.ticketId } })).state).toBe(
      'new',
    );
  });
});
