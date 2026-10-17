import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
let colleague: Client;
let stranger: Client;
let agentId: string;
let outsiderId: string;
let customerId: string;
let colleagueId: string;
let strangerId: string;

const phoneTicket = (over: Record<string, unknown> = {}) => ({
  title: 'No puedo cargar la plantilla de beneficiarios',
  groupId: GROUP_N1,
  customerId,
  article: { type: 'phone', callDirection: 'in', body: '<p>Llamó el cliente</p>' },
  ...over,
});

beforeAll(async () => {
  t = await startApp();
  const internal = await makeOrg(t.prisma, { internal: true });
  const clientOrg = await makeOrg(t.prisma);
  const otherOrg = await makeOrg(t.prisma);
  const a = await makeUser(t.prisma, 'AGENT', internal.id);
  const o = await makeUser(t.prisma, 'AGENT', internal.id);
  const c = await makeUser(t.prisma, 'CUSTOMER', clientOrg.id);
  const cc = await makeUser(t.prisma, 'CUSTOMER', clientOrg.id, { orgTicketAccess: true });
  const s = await makeUser(t.prisma, 'CUSTOMER', otherOrg.id);
  [agentId, outsiderId, customerId, colleagueId, strangerId] = [a.id, o.id, c.id, cc.id, s.id];
  await grantGroup(t.prisma, a.id, GROUP_N1, ['full']);
  await grantGroup(t.prisma, o.id, GROUP_N2, ['full']);
  agent = new Client(t.app, AGENT);
  outsider = new Client(t.app, AGENT);
  customer = new Client(t.app, PORTAL);
  colleague = new Client(t.app, PORTAL);
  stranger = new Client(t.app, PORTAL);
  await agent.loginAndEnroll(a.email);
  await outsider.loginAndEnroll(o.email);
  await customer.login(c.email);
  await colleague.login(cc.email);
  await stranger.login(s.email);
});
afterAll(async () => t.close());

describe('ticket creation and access', () => {
  it('lets an agent log a phone call as a ticket with SLA due dates', async () => {
    const res = await agent.post('/api/v1/tickets', phoneTicket({ tags: ['Carga'] }));
    expect(res.statusCode).toBe(201);
    const ticket = res.json();
    expect(ticket.number).toMatch(/^\d{12}$/);
    expect(ticket.state).toBe('open');
    expect(ticket.tags).toEqual(['carga']);
    expect(ticket.slaId).toBeTruthy();
    expect(ticket.firstResponseDueAt).toBeTruthy();
    expect(ticket.organization).toBeTruthy();
    const articles = (await agent.get(`/api/v1/tickets/${ticket.id}/articles`)).json();
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({ type: 'phone', sender: 'customer', callDirection: 'in' });
  });

  it('denies creation in groups without create access and hides other groups', async () => {
    expect((await outsider.post('/api/v1/tickets', phoneTicket())).statusCode).toBe(403);
    const ticket = (await agent.post('/api/v1/tickets', phoneTicket())).json();
    expect((await outsider.get(`/api/v1/tickets/${ticket.id}`)).statusCode).toBe(404);
    expect(
      (await outsider.post(`/api/v1/tickets/${ticket.id}/articles`, { type: 'note', body: 'x' }))
        .statusCode,
    ).toBe(404);
  });

  it('scopes customers to their own tickets, or their organization when allowed', async () => {
    const ticket = (await agent.post('/api/v1/tickets', phoneTicket())).json();
    expect((await customer.get(`/api/v1/tickets/${ticket.id}`)).statusCode).toBe(200);
    expect((await colleague.get(`/api/v1/tickets/${ticket.id}`)).statusCode).toBe(200);
    expect((await stranger.get(`/api/v1/tickets/${ticket.id}`)).statusCode).toBe(404);
    const view = (await customer.get(`/api/v1/tickets/${ticket.id}`)).json();
    expect(view).not.toHaveProperty('slaId');
    expect(view).not.toHaveProperty('owner');
    const list = (await stranger.get('/api/v1/tickets?overview=mis-abiertos')).json();
    expect(list.items.find((x: { id: string }) => x.id === ticket.id)).toBeUndefined();
  });

  it('keeps internal notes away from customers and sanitises HTML', async () => {
    const ticket = (await agent.post('/api/v1/tickets', phoneTicket())).json();
    await agent.post(`/api/v1/tickets/${ticket.id}/articles`, {
      type: 'note',
      internal: true,
      body: '<p>Nota interna<script>alert(1)</script><img src=x onerror=alert(1)></p>',
    });
    const forAgent = (await agent.get(`/api/v1/tickets/${ticket.id}/articles`)).json();
    const note = forAgent.find((a: { type: string }) => a.type === 'note');
    expect(note.bodyHtml).not.toMatch(/script|onerror/);
    const forCustomer = (await customer.get(`/api/v1/tickets/${ticket.id}/articles`)).json();
    expect(forCustomer.some((a: { type: string }) => a.type === 'note')).toBe(false);
    expect(forCustomer[0]).not.toHaveProperty('internal');
  });

  it('lets customers open tickets from the portal but only with portal fields', async () => {
    const bad = await customer.post('/api/v1/tickets', { ...phoneTicket(), body: 'x' });
    expect(bad.statusCode).toBe(400);
    const res = await customer.post('/api/v1/tickets', {
      title: 'Duda sobre el cálculo de bonos',
      body: '<p>Hola</p>',
      customFields: { inncentives_environment: 'prod' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().state).toBe('new');
    const list = (await agent.get('/api/v1/tickets?overview=sin-asignar')).json();
    expect(list.items.some((x: { id: string }) => x.id === res.json().id)).toBe(true);
    expect(
      (
        await customer.post('/api/v1/tickets', {
          title: 'x',
          body: 'y',
          customFields: { nope: 'x' },
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('ticket lifecycle', () => {
  it('records first response, reopens on customer reply and queues outbound e-mail', async () => {
    const created = (
      await customer.post('/api/v1/tickets', { title: 'Error en reporte', body: 'Detalle' })
    ).json();
    const reply = await agent.post(`/api/v1/tickets/${created.id}/articles`, {
      type: 'email',
      body: '<p>Revisamos</p>',
    });
    expect(reply.statusCode).toBe(201);
    expect(t.outbound).toContain(reply.json().id);
    let tk = (await agent.get(`/api/v1/tickets/${created.id}`)).json();
    expect(tk.state).toBe('open');
    expect(tk.firstResponseAt).toBeTruthy();
    expect(tk.firstResponseDueAt).toBeNull();

    const pending = await agent.patch(`/api/v1/tickets/${created.id}`, {
      state: 'pending_reminder',
      pendingUntil: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().escalationAt).toBeNull();
    await customer.post(`/api/v1/tickets/${created.id}/articles`, {
      type: 'web',
      body: 'Sigue fallando',
    });
    tk = (await agent.get(`/api/v1/tickets/${created.id}`)).json();
    expect(tk.state).toBe('open');
    expect(tk.pendingUntil).toBeNull();

    const history = (await agent.get(`/api/v1/tickets/${created.id}/history`)).json();
    expect(history.map((h: { field: string }) => h.field)).toEqual(
      expect.arrayContaining(['created', 'state']),
    );
    expect((await customer.get(`/api/v1/tickets/${created.id}/history`)).statusCode).toBe(421);
  });

  it('requires a date for pending states and validates owners', async () => {
    const tk = (await agent.post('/api/v1/tickets', phoneTicket())).json();
    expect(
      (await agent.patch(`/api/v1/tickets/${tk.id}`, { state: 'pending_close' })).statusCode,
    ).toBe(400);
    expect(
      (await agent.patch(`/api/v1/tickets/${tk.id}`, { ownerId: outsiderId })).statusCode,
    ).toBe(400);
    const own = await agent.patch(`/api/v1/tickets/${tk.id}`, { ownerId: agentId });
    expect(own.json().owner.id).toBe(agentId);
  });

  it('lets customers close their tickets but change nothing else', async () => {
    const tk = (await agent.post('/api/v1/tickets', phoneTicket())).json();
    expect(
      (await customer.patch(`/api/v1/tickets/${tk.id}`, { priorityId: tk.priority.id })).statusCode,
    ).toBe(403);
    expect((await customer.patch(`/api/v1/tickets/${tk.id}`, { state: 'open' })).statusCode).toBe(
      403,
    );
    const closed = await customer.patch(`/api/v1/tickets/${tk.id}`, { state: 'closed' });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().state).toBe('closed');
    expect(
      (
        await customer.post(`/api/v1/tickets/${tk.id}/articles`, {
          type: 'note',
          internal: true,
          body: 'x',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('merges tickets, moving the articles', async () => {
    const a = (await agent.post('/api/v1/tickets', phoneTicket())).json();
    const b = (await agent.post('/api/v1/tickets', phoneTicket())).json();
    expect((await agent.post(`/api/v1/tickets/${a.id}/merge`, { targetId: b.id })).statusCode).toBe(
      204,
    );
    expect((await agent.get(`/api/v1/tickets/${a.id}`)).json()).toMatchObject({
      state: 'merged',
      mergedIntoId: b.id,
    });
    expect((await agent.get(`/api/v1/tickets/${b.id}/articles`)).json()).toHaveLength(2);
    expect((await customer.get(`/api/v1/tickets/${a.id}`)).statusCode).toBe(404);
    expect((await agent.patch(`/api/v1/tickets/${a.id}`, { title: 'x' })).statusCode).toBe(409);
  });

  it('supports links, checklist, time accounting, drafts and subscriptions', async () => {
    const a = (await agent.post('/api/v1/tickets', phoneTicket())).json();
    const b = (await agent.post('/api/v1/tickets', phoneTicket())).json();
    expect(
      (await agent.post(`/api/v1/tickets/${a.id}/links`, { targetId: b.id, type: 'parent' }))
        .statusCode,
    ).toBe(204);
    expect((await agent.get(`/api/v1/tickets/${b.id}/links`)).json()).toEqual([
      expect.objectContaining({ type: 'child', ticket: expect.objectContaining({ id: a.id }) }),
    ]);
    const item = (
      await agent.post(`/api/v1/tickets/${a.id}/checklist`, { text: 'Revisar logs' })
    ).json();
    expect(
      (await agent.patch(`/api/v1/tickets/${a.id}/checklist/${item.id}`, { done: true }))
        .statusCode,
    ).toBe(204);
    expect(
      (await agent.post(`/api/v1/tickets/${a.id}/time-entries`, { minutes: 15 })).statusCode,
    ).toBe(204);
    expect((await agent.get(`/api/v1/tickets/${a.id}`)).json().timeSpentMinutes).toBe(15);
    expect(
      (await agent.put(`/api/v1/tickets/${a.id}/draft`, { body: '<p>borrador</p>' })).statusCode,
    ).toBe(204);
    expect((await agent.get(`/api/v1/tickets/${a.id}/draft`)).json().body).toBe('<p>borrador</p>');
    expect((await agent.delete(`/api/v1/tickets/${a.id}/subscription`)).statusCode).toBe(204);
    expect((await agent.get(`/api/v1/tickets/${a.id}`)).json().subscribed).toBe(false);
    expect((await outsider.get(`/api/v1/tickets/${a.id}/checklist`)).statusCode).toBe(404);
  });
});

describe('automation', () => {
  it('runs triggers once per chain and enforces core workflows', async () => {
    await t.prisma.trigger.create({
      data: {
        name: 'Etiqueta urgente',
        event: 'create_or_update',
        conditions: {
          op: 'and',
          conditions: [{ field: 'ticket.title', operator: 'contains', value: 'urgente' }],
        },
        actions: [
          { type: 'add_tags', tags: ['urgente'] },
          { type: 'add_note', body: 'Ticket {{ticket.number}} marcado como urgente' },
        ],
      },
    });
    const tk = (await agent.post('/api/v1/tickets', phoneTicket({ title: 'Caso urgente' }))).json();
    const fresh = (await agent.get(`/api/v1/tickets/${tk.id}`)).json();
    expect(fresh.tags).toContain('urgente');
    const notes = (await agent.get(`/api/v1/tickets/${tk.id}/articles`))
      .json()
      .filter((a: { type: string }) => a.type === 'note');
    // Depth/once-per-chain protection: the note's own update must not add more notes.
    expect(notes).toHaveLength(1);
    expect(notes[0].bodyHtml).toContain(tk.number);

    await t.prisma.coreWorkflow.create({
      data: {
        name: 'Módulo obligatorio en N1',
        screens: ['create_agent'],
        conditions: {
          op: 'and',
          conditions: [{ field: 'ticket.group_id', operator: 'is', value: GROUP_N1 }],
        },
        actions: { 'custom.inncentives_module': { mandatory: true } },
      },
    });
    const denied = await agent.post('/api/v1/tickets', phoneTicket());
    expect(denied.statusCode).toBe(400);
    expect(denied.json().error.details).toEqual([
      { path: 'custom.inncentives_module', code: 'required' },
    ]);
    const evalRes = await agent.post('/api/v1/ticket-form/evaluate', {
      screen: 'create_agent',
      values: { group_id: GROUP_N1 },
    });
    expect(evalRes.json().fields['custom.inncentives_module']).toEqual({ mandatory: true });
    const ok = await agent.post(
      '/api/v1/tickets',
      phoneTicket({ customFields: { inncentives_module: 'reportes' } }),
    );
    expect(ok.statusCode).toBe(201);
    await t.prisma.coreWorkflow.deleteMany({});
    await t.prisma.trigger.deleteMany({});
  });

  it('applies macros with the agent permissions and bulk updates per ticket', async () => {
    const macro = await t.prisma.macro.create({
      data: {
        name: 'Cerrar por solución',
        actions: [
          { type: 'set', field: 'state', value: 'resolved' },
          { type: 'add_tags', tags: ['resuelto'] },
        ],
      },
    });
    const tk = (await agent.post('/api/v1/tickets', phoneTicket())).json();
    const res = await agent.post(`/api/v1/tickets/${tk.id}/macros/${macro.id}`);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ state: 'resolved', tags: ['resuelto'] });

    const other = (await agent.post('/api/v1/tickets', phoneTicket())).json();
    const bulk = await outsider.post('/api/v1/tickets/bulk', {
      ids: [other.id],
      changes: { state: 'closed' },
    });
    expect(bulk.json().results).toEqual([{ id: other.id, ok: false, error: 'not_found' }]);
    const mine = await agent.post('/api/v1/tickets/bulk', {
      ids: [other.id],
      changes: { state: 'closed' },
      addTags: ['lote'],
    });
    expect(mine.json().results).toEqual([{ id: other.id, ok: true }]);
  });

  it('lists overviews by role with counts', async () => {
    const agentViews = (await agent.get('/api/v1/overviews')).json();
    expect(agentViews.map((o: { slug: string }) => o.slug)).toContain('sin-asignar');
    const customerViews = (await customer.get('/api/v1/overviews')).json();
    expect(customerViews.map((o: { slug: string }) => o.slug)).toEqual([
      'mis-abiertos',
      'mis-cerrados',
      'organizacion',
    ]);
    expect((await customer.get('/api/v1/tickets?overview=sin-asignar')).statusCode).toBe(404);
  });

  it('serves form metadata per audience and customer lookup to agents only', async () => {
    const meta = (await agent.get('/api/v1/ticket-form')).json();
    expect(meta.groups.map((g: { id: string }) => g.id)).toEqual([GROUP_N1]);
    expect(meta.ownersByGroup[GROUP_N1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: agentId })]),
    );
    expect(meta.ownersByGroup[GROUP_N1]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: outsiderId })]),
    );
    const portal = (await customer.get('/api/v1/ticket-form')).json();
    expect(portal).not.toHaveProperty('groups');
    expect(portal.privacyNotice.es).toMatch(/RFC/);
    const found = (await agent.get('/api/v1/lookup/customers?q=customer')).json();
    expect(found.length).toBeGreaterThan(0);
    expect((await customer.get('/api/v1/lookup/customers?q=customer')).statusCode).toBe(421);
    void colleagueId;
    void strangerId;
  });
});
