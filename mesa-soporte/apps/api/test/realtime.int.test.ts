import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
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
let port: number;
let agent: Client;
let customer: Client;
let stranger: Client;
let customerId: string;
let agentId: string;
const sockets: Socket[] = [];

function connect(c: Client | null, host: string, origin = `https://${host}`): Promise<Socket> {
  return new Promise((resolve) => {
    const s = io(`http://127.0.0.1:${port}`, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { host, origin, ...(c?.cookie ? { cookie: `__Host-sid=${c.cookie}` } : {}) },
    });
    sockets.push(s);
    s.on('connect', () => setTimeout(() => resolve(s), 100));
    s.on('disconnect', () => resolve(s));
    s.on('connect_error', () => resolve(s));
  });
}

function next(s: Socket, event: string, ms = 2000): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    s.once(event, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

beforeAll(async () => {
  t = await startApp();
  await t.app.listen(0, '127.0.0.1');
  port = (t.app.getHttpServer().address() as AddressInfo).port;
  const internal = await makeOrg(t.prisma, { internal: true });
  const org = await makeOrg(t.prisma);
  const a = await makeUser(t.prisma, 'AGENT', internal.id);
  const c = await makeUser(t.prisma, 'CUSTOMER', org.id);
  const s = await makeUser(t.prisma, 'CUSTOMER', (await makeOrg(t.prisma)).id);
  [agentId, customerId] = [a.id, c.id];
  await grantGroup(t.prisma, a.id, GROUP_N1);
  agent = new Client(t.app, AGENT);
  customer = new Client(t.app, PORTAL);
  stranger = new Client(t.app, PORTAL);
  await agent.loginAndEnroll(a.email);
  await customer.login(c.email);
  await stranger.login(s.email);
});
afterAll(async () => {
  sockets.forEach((s) => s.close());
  await t.close();
});

describe('search', () => {
  it('finds tickets by title and article text within the caller scope', async () => {
    const tk = (
      await agent.post('/api/v1/tickets', {
        title: 'Cálculo de comisiones trimestrales',
        groupId: GROUP_N1,
        customerId,
        article: { type: 'phone', body: 'El reporte de liquidación no cuadra' },
      })
    ).json();
    await agent.post(`/api/v1/tickets/${tk.id}/articles`, {
      type: 'note',
      internal: true,
      body: 'contraseña provisional zanahoria',
    });
    const ids = async (c: Client, q: string) =>
      (await c.get(`/api/v1/search?q=${encodeURIComponent(q)}`))
        .json()
        .items.map((x: { id: string }) => x.id);
    expect(await ids(agent, 'comision')).toContain(tk.id);
    expect(await ids(agent, 'liquidacion')).toContain(tk.id);
    expect(await ids(agent, 'zanahoria')).toContain(tk.id);
    expect(await ids(customer, 'liquidación')).toContain(tk.id);
    expect(await ids(customer, 'zanahoria')).not.toContain(tk.id);
    expect(await ids(stranger, 'comisiones')).toEqual([]);
    expect(await ids(agent, `#${tk.number}`)).toEqual([tk.id]);
    expect(await ids(agent, 'state:open comisiones')).toContain(tk.id);
    expect(await ids(agent, "'; DROP TABLE tickets; --")).toEqual([]);
  });
});

describe('notifications', () => {
  it('lists and marks the user notifications', async () => {
    await customer.post('/api/v1/tickets', { title: 'Nueva solicitud', body: 'Hola' });
    await t.prisma.ticket.updateMany({
      where: { title: 'Nueva solicitud' },
      data: { ownerId: agentId },
    });
    const tk = await t.prisma.ticket.findFirstOrThrow({ where: { title: 'Nueva solicitud' } });
    await customer.post(`/api/v1/tickets/${tk.id}/articles`, { type: 'web', body: 'Más detalles' });
    const list = (await agent.get('/api/v1/me/notifications')).json();
    expect(list.unread).toBeGreaterThan(0);
    expect(list.items.some((n: { type: string }) => n.type === 'customer_reply')).toBe(true);
    expect((await agent.post('/api/v1/me/notifications/read', { all: true })).statusCode).toBe(204);
    expect((await agent.get('/api/v1/me/notifications')).json().unread).toBe(0);
    expect((await customer.patch('/api/v1/me/preferences', { outOfOffice: true })).statusCode).toBe(
      403,
    );
    const prefs = await agent.patch('/api/v1/me/preferences', {
      notificationPrefs: { email: { ticket_updated: true } },
    });
    expect(prefs.json().notificationPrefs).toEqual({ email: { ticket_updated: true } });
  });
});

describe('realtime', () => {
  it('rejects sockets without a valid session, host or origin', async () => {
    expect((await connect(null, AGENT)).connected).toBe(false);
    expect((await connect(agent, AGENT, 'https://evil.example')).connected).toBe(false);
    expect((await connect(agent, PORTAL)).connected).toBe(false);
  });

  it('delivers ticket events only to authorised rooms, without ticket data', async () => {
    const tk = (
      await agent.post('/api/v1/tickets', {
        title: 'Tiempo real',
        groupId: GROUP_N1,
        customerId,
        article: { type: 'phone', body: 'x' },
      })
    ).json();
    const as = await connect(agent, AGENT);
    const cs = await connect(customer, PORTAL);
    const ss = await connect(stranger, PORTAL);
    expect([as.connected, cs.connected, ss.connected]).toEqual([true, true, true]);

    const [forAgent, forCustomer, forStranger] = [
      next(as, 'ticket'),
      next(cs, 'ticket'),
      next(ss, 'ticket', 800),
    ];
    await customer.post(`/api/v1/tickets/${tk.id}/articles`, { type: 'web', body: 'respuesta' });
    expect(await forAgent).toEqual({ type: 'article.created', ticketId: tk.id });
    expect(await forCustomer).toEqual({ type: 'article.created', ticketId: tk.id });
    expect(await forStranger).toBeNull();

    // Internal notes are not announced to customers.
    const internalForCustomer = next(cs, 'ticket', 800);
    const internalForAgent = next(as, 'ticket');
    await agent.post(`/api/v1/tickets/${tk.id}/articles`, {
      type: 'note',
      internal: true,
      body: 'nota',
    });
    expect(await internalForAgent).toEqual({ type: 'article.created', ticketId: tk.id });
    expect(await internalForCustomer).toBeNull();
  });

  it('tracks presence for agents and refuses customers', async () => {
    const tk = await t.prisma.ticket.findFirstOrThrow({ where: { title: 'Tiempo real' } });
    const as = await connect(agent, AGENT);
    const presence = next(as, 'presence');
    expect(await as.emitWithAck('ticket:watch', { ticketId: tk.id })).toEqual({ ok: true });
    expect(await presence).toEqual({
      ticketId: tk.id,
      viewers: [{ id: agentId, name: 'AGENT test', typing: false }],
    });
    const cs = await connect(customer, PORTAL);
    expect(await cs.emitWithAck('ticket:watch', { ticketId: tk.id })).toEqual({ ok: false });
  });
});
