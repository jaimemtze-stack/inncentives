import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signPayload } from '../src/channels/phone/signature';
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
let stranger: Client;
let customerId: string;
let ticketId: string;

function multipart(filename: string, content: Buffer) {
  const boundary = `----mesa${randomBytes(8).toString('hex')}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function upload(c: Client, filename: string, content: Buffer) {
  const m = multipart(filename, content);
  return c.request('POST', '/api/v1/attachments', m.payload, { headers: m.headers });
}

beforeAll(async () => {
  t = await startApp();
  const internal = await makeOrg(t.prisma, { internal: true });
  const org = await makeOrg(t.prisma);
  const a = await makeUser(t.prisma, 'AGENT', internal.id);
  const c = await makeUser(t.prisma, 'CUSTOMER', org.id, { phone: '+525512345678' });
  const s = await makeUser(t.prisma, 'CUSTOMER', (await makeOrg(t.prisma)).id);
  customerId = c.id;
  await grantGroup(t.prisma, a.id, GROUP_N1);
  agent = new Client(t.app, AGENT);
  customer = new Client(t.app, PORTAL);
  stranger = new Client(t.app, PORTAL);
  await agent.loginAndEnroll(a.email);
  await customer.login(c.email);
  await stranger.login(s.email);
  ticketId = (
    await agent.post('/api/v1/tickets', {
      title: 'Adjuntos',
      groupId: GROUP_N1,
      customerId,
      article: { type: 'phone', body: 'Llamada' },
    })
  ).json().id;
});
afterAll(async () => t.close());

describe('attachments', () => {
  it('accepts allowed files, rejects disguised ones and gates downloads on the scan', async () => {
    expect(
      (await upload(customer, 'factura.pdf', Buffer.from('MZ\x90\x00binario'))).json().error
        .details,
    ).toEqual([{ path: 'file', code: 'type_mismatch' }]);
    expect((await upload(customer, 'x.html', Buffer.from('<script>'))).statusCode).toBe(400);
    const up = await upload(customer, 'datos.csv', Buffer.from('nombre,sueldo\nAna,100'));
    expect(up.statusCode).toBe(201);
    const id = up.json().id;
    expect(t.scans).toContain(id);
    // Staged uploads belong to the uploader only.
    expect((await stranger.get(`/api/v1/attachments/${id}`)).statusCode).toBe(404);

    const reply = await customer.post(`/api/v1/tickets/${ticketId}/articles`, {
      type: 'web',
      body: 'Adjunto archivo',
      attachmentIds: [id],
    });
    expect(reply.statusCode).toBe(201);
    // Re-using an attachment on another article is refused.
    expect(
      (
        await customer.post(`/api/v1/tickets/${ticketId}/articles`, {
          type: 'web',
          body: 'otra vez',
          attachmentIds: [id],
        })
      ).statusCode,
    ).toBe(400);
    expect((await agent.get(`/api/v1/attachments/${id}`)).statusCode).toBe(409);
    await t.prisma.attachment.update({ where: { id }, data: { scanStatus: 'clean' } });
    const dl = await agent.get(`/api/v1/attachments/${id}`);
    expect(dl.statusCode).toBe(200);
    expect(dl.json().url).toMatch(/X-Amz-Expires=60/);
    expect((await stranger.get(`/api/v1/attachments/${id}`)).statusCode).toBe(404);
    const audit = await t.prisma.auditLog.findFirst({
      where: { action: 'attachment.downloaded', targetId: id },
    });
    expect(audit).toBeTruthy();
  });

  it('hides attachments of internal notes from customers and re-encodes images', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } })
      .png()
      .withMetadata({ exif: { IFD0: { Copyright: 'secreto' } } })
      .toBuffer();
    const id = (await upload(agent, 'captura.png', png)).json().id;
    await agent.post(`/api/v1/tickets/${ticketId}/articles`, {
      type: 'note',
      internal: true,
      body: 'interna',
      attachmentIds: [id],
    });
    await t.prisma.attachment.update({ where: { id }, data: { scanStatus: 'clean' } });
    expect((await customer.get(`/api/v1/attachments/${id}`)).statusCode).toBe(404);
    const inline = await agent.get(`/api/v1/attachments/${id}/inline`);
    expect(inline.statusCode).toBe(200);
    expect(inline.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('flags sensitive data, lets agents redact and delete with audit', async () => {
    const r = await customer.post('/api/v1/sensitive-check', { text: 'CURP BADD110313HCMLNS06' });
    expect(r.json().findings).toEqual([{ kind: 'curp', count: 1 }]);
    const art = await customer.post(`/api/v1/tickets/${ticketId}/articles`, {
      type: 'web',
      body: 'Mi CURP es BADD110313HCMLNS06',
    });
    expect((await agent.get(`/api/v1/tickets/${ticketId}`)).json().sensitiveData).toBe(true);
    expect((await customer.post(`/api/v1/articles/${art.json().id}/redact`)).statusCode).toBe(421);
    expect((await agent.post(`/api/v1/articles/${art.json().id}/redact`)).statusCode).toBe(204);
    const stored = await t.prisma.article.findUniqueOrThrow({ where: { id: art.json().id } });
    expect(stored.bodyText).toBe('Mi CURP es [REDACTADO]');
    expect(
      await t.prisma.auditLog.findFirst({
        where: { action: 'article.redacted', targetId: stored.id },
      }),
    ).toBeTruthy();

    const att = await t.prisma.attachment.findFirstOrThrow({
      where: { ticketId, filename: 'datos.csv' },
    });
    expect((await agent.delete(`/api/v1/attachments/${att.id}`)).statusCode).toBe(204);
    expect((await agent.get(`/api/v1/attachments/${att.id}`)).statusCode).toBe(404);
  });
});

describe('phone channel', () => {
  it('finds callers by number with their open tickets', async () => {
    const res = (await agent.get('/api/v1/phone/lookup?number=55%201234%205678')).json();
    expect(res.normalized).toBe('+525512345678');
    expect(res.customers.map((c: { id: string }) => c.id)).toEqual([customerId]);
    expect(res.tickets.map((x: { id: string }) => x.id)).toContain(ticketId);
    expect((await customer.get('/api/v1/phone/lookup?number=5512345678')).statusCode).toBe(421);
  });

  it('accepts only signed, fresh, non-replayed CTI webhooks', async () => {
    process.env.SECRET_CTI_WEBHOOK_SECRET = 'cti-test-secret';
    const body = JSON.stringify({
      event: 'newCall',
      callId: 'c-1',
      direction: 'in',
      from: '5512345678',
      to: '100',
    });
    const hook = new Client(t.app, PORTAL);
    const send = (sig: string, payload = body) =>
      hook.request('POST', '/hooks/cti', Buffer.from(payload), {
        origin: null,
        headers: { 'content-type': 'application/json', 'x-mesa-signature': sig },
      });
    expect((await send('t=1,v1=00')).statusCode).toBe(401);
    const sig = signPayload('cti-test-secret', body);
    expect((await send(sig)).statusCode).toBe(204);
    expect((await send(sig)).statusCode).toBe(409);
    const log = await t.prisma.callLog.findUniqueOrThrow({ where: { callId: 'c-1' } });
    expect(log).toMatchObject({ state: 'ringing', customerId });
    const tampered = body.replace('newCall', 'hangup');
    expect((await send(sig, tampered)).statusCode).toBe(401);
    const hangup = JSON.stringify({
      event: 'hangup',
      callId: 'c-1',
      direction: 'in',
      from: '5512345678',
      to: '100',
    });
    expect((await send(signPayload('cti-test-secret', hangup), hangup)).statusCode).toBe(204);
    expect(
      (await t.prisma.callLog.findUniqueOrThrow({ where: { callId: 'c-1' } })).endedAt,
    ).toBeTruthy();
  });
});
