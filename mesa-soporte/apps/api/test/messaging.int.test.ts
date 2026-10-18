import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TwilioSmsClient, WhatsAppClient } from '../src/channels/messaging/clients';
import { MessagingService } from '../src/channels/messaging/messaging.service';
import { TRIAGE_GROUP_ID } from '../src/channels/email/ingest.service';
import { twilioSignature } from '../src/channels/twilio/twilio';
import {
  AGENT,
  Client,
  GROUP_N2,
  PASSWORD,
  PORTAL,
  grantGroup,
  makeOrg,
  makeUser,
  startApp,
  type TestApp,
} from './helpers';

const APP_SECRET = 'meta-app-secret';
const TW_TOKEN = 'twilio-token';
const WA_PHONE_ID = '1098765432';
const WA_NUMBER = '+525500001111';
const SMS_NUMBER = '+525500002222';
let t: TestApp;
let hook: Client;
let agent: Client;
let customerId: string;
const sent: Array<{ to: string; body: string }> = [];
let seq = 0;

const waPayload = (from: string, text: string, extra: Record<string, unknown> = {}) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: WA_NUMBER.slice(1), phone_number_id: WA_PHONE_ID },
            contacts: [{ profile: { name: 'Contacto' }, wa_id: from }],
            messages: [
              { from, id: `wamid.${++seq}`, type: 'text', text: { body: text }, ...extra },
            ],
          },
        },
      ],
    },
  ],
});

const postWa = (payload: unknown, secret = APP_SECRET) => {
  const raw = JSON.stringify(payload);
  return hook.request('POST', '/hooks/whatsapp', raw, {
    origin: null,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'),
    },
  });
};

const postSms = (params: Record<string, string>) =>
  hook.request('POST', '/hooks/twilio/sms', new URLSearchParams(params).toString(), {
    origin: null,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': twilioSignature(TW_TOKEN, `https://${PORTAL}/hooks/twilio/sms`, params),
    },
  });

beforeAll(async () => {
  Object.assign(process.env, {
    SECRET_WHATSAPP_APP_SECRET: APP_SECRET,
    SECRET_WHATSAPP_VERIFY_TOKEN: 'verify-me',
    SECRET_WHATSAPP_ACCESS_TOKEN: 'wa-token',
    SECRET_TWILIO_AUTH_TOKEN: TW_TOKEN,
  });
  t = await startApp();
  await t.prisma.appSetting.upsert({
    where: { key: 'messaging' },
    create: {
      key: 'messaging',
      value: {
        whatsappApiVersion: 'v21.0',
        twilioAccountSid: 'AC' + 'c'.repeat(32),
        reopenDays: 7,
      },
    },
    update: {},
  });
  const svc = t.app.get(MessagingService);
  vi.spyOn(svc, 'whatsapp').mockResolvedValue({
    sendText: async (_id: string, to: string, body: string) => {
      sent.push({ to, body });
      return `wa:wamid.out${sent.length}`;
    },
    download: async () => ({
      buffer: Buffer.from('%PDF-1.4\n%fake\n'),
      mimeType: 'application/pdf',
    }),
  } as unknown as WhatsAppClient);
  vi.spyOn(svc, 'twilio').mockResolvedValue({
    send: async (_from: string, to: string, body: string) => {
      sent.push({ to, body });
      return `tw:SM${'d'.repeat(32)}`;
    },
  } as unknown as TwilioSmsClient);

  const internal = await makeOrg(t.prisma, { internal: true });
  const org = await makeOrg(t.prisma);
  const c = await makeUser(t.prisma, 'CUSTOMER', org.id);
  customerId = c.id;
  await t.prisma.user.update({ where: { id: c.id }, data: { mobile: '+525511112222' } });
  const a = await makeUser(t.prisma, 'AGENT', internal.id);
  await grantGroup(t.prisma, a.id, GROUP_N2);
  await grantGroup(t.prisma, a.id, TRIAGE_GROUP_ID);
  const admin = new Client(t.app, AGENT);
  await admin.loginAndEnroll((await makeUser(t.prisma, 'ADMIN', internal.id)).email);
  await admin.post('/api/v1/auth/reauth', { password: PASSWORD });
  for (const ch of [
    {
      kind: 'whatsapp',
      name: 'WhatsApp soporte',
      providerId: WA_PHONE_ID,
      displayNumber: WA_NUMBER,
    },
    { kind: 'sms', name: 'SMS soporte', providerId: SMS_NUMBER, displayNumber: SMS_NUMBER },
  ]) {
    const r = await admin.post('/api/v1/admin/config/messaging-channels', {
      ...ch,
      groupId: GROUP_N2,
    });
    expect(r.statusCode).toBe(201);
  }
  agent = new Client(t.app, AGENT);
  await agent.loginAndEnroll(a.email);
  hook = new Client(t.app, PORTAL);
});
afterAll(async () => t.close());

describe('WhatsApp Business', () => {
  it('answers the subscription check only with the verify token', async () => {
    const ok = await hook.get(
      '/hooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1158201444',
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.text).toBe('1158201444');
    expect(
      (await hook.get('/hooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1'))
        .statusCode,
    ).toBe(403);
  });

  it('turns signed messages into one conversation ticket and ignores replays', async () => {
    expect((await postWa(waPayload('5215511112222', 'x'), 'forged')).statusCode).toBe(401);
    const first = waPayload('5215511112222', 'No puedo descargar mi recibo');
    expect((await postWa(first)).statusCode).toBe(200);
    expect((await postWa(first)).statusCode).toBe(200); // Meta retry
    await postWa(
      waPayload('5215511112222', '', {
        type: 'document',
        document: {
          id: 'MEDIA1',
          mime_type: 'application/pdf',
          filename: 'recibo.pdf',
          caption: 'Adjunto',
        },
      }),
    );
    const tickets = await t.prisma.ticket.findMany({
      where: { channel: 'whatsapp', customerId },
      include: { articles: { include: { attachments: true } } },
    });
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ groupId: GROUP_N2, title: 'No puedo descargar mi recibo' });
    expect(tickets[0]!.articles).toHaveLength(2);
    expect(tickets[0]!.articles[1]!.attachments[0]?.filename).toBe('recibo.pdf');
  });

  it('sends unknown numbers to triage without a customer', async () => {
    await postWa(waPayload('5219999999999', 'Hola, soy nuevo'));
    const tk = await t.prisma.ticket.findFirstOrThrow({ where: { title: 'Hola, soy nuevo' } });
    expect(tk).toMatchObject({ customerId: null, groupId: TRIAGE_GROUP_ID });
    expect(tk.unverifiedFrom).toContain('+5219999999999');
  });

  it('delivers agent replies inside the 24-hour window and tracks receipts', async () => {
    const tk = await t.prisma.ticket.findFirstOrThrow({
      where: { channel: 'whatsapp', customerId },
    });
    const res = await agent.post(`/api/v1/tickets/${tk.id}/articles`, {
      type: 'whatsapp',
      body: '<p>Ya lo revisamos, intenta de nuevo.</p>',
    });
    expect(res.statusCode).toBe(201);
    const art = await t.prisma.article.findFirstOrThrow({
      where: { ticketId: tk.id, type: 'whatsapp', sender: 'agent' },
    });
    expect(art).toMatchObject({
      deliveryStatus: 'queued',
      toAddresses: '+5215511112222',
      fromAddress: WA_NUMBER,
    });
    expect(t.outbound).toContain(art.id);
    await t.app.get(MessagingService).sendArticle(art.id, false);
    expect(sent.at(-1)).toEqual({
      to: '+5215511112222',
      body: 'Ya lo revisamos, intenta de nuevo.',
    });
    const after = await t.prisma.article.findUniqueOrThrow({ where: { id: art.id } });
    expect(after.deliveryStatus).toBe('sent');

    const receipt = (status: string) => ({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: WA_PHONE_ID },
                statuses: [{ id: after.externalId!.slice(3), status }],
              },
            },
          ],
        },
      ],
    });
    await postWa(receipt('read'));
    await postWa(receipt('delivered'));
    expect(
      (await t.prisma.article.findUniqueOrThrow({ where: { id: art.id } })).deliveryStatus,
    ).toBe('read');

    // Outside the window WhatsApp refuses free-form messages: so do we.
    await t.prisma.article.updateMany({
      where: { ticketId: tk.id, sender: 'customer' },
      data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
    });
    expect(
      (await agent.post(`/api/v1/tickets/${tk.id}/articles`, { type: 'whatsapp', body: 'x' }))
        .statusCode,
    ).toBe(409);
  });
});

describe('SMS (Twilio)', () => {
  it('receives, replies and records the delivery status', async () => {
    const sid = 'SM' + 'e'.repeat(32);
    const inbound = {
      MessageSid: sid,
      From: '+525511112222',
      To: SMS_NUMBER,
      Body: 'Mi acceso no funciona',
      SmsStatus: 'received',
    };
    const bad = await hook.request(
      'POST',
      '/hooks/twilio/sms',
      new URLSearchParams(inbound).toString(),
      {
        origin: null,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': 'AAAA',
        },
      },
    );
    expect(bad.statusCode).toBe(401);
    const ok = await postSms(inbound);
    expect(ok.statusCode).toBe(200);
    expect(ok.text).toContain('<Response>');
    const tk = await t.prisma.ticket.findFirstOrThrow({ where: { channel: 'sms', customerId } });
    expect(
      (
        await agent.post(`/api/v1/tickets/${tk.id}/articles`, {
          type: 'sms',
          body: 'Te llamamos en 5 minutos',
        })
      ).statusCode,
    ).toBe(201);
    const art = await t.prisma.article.findFirstOrThrow({
      where: { ticketId: tk.id, sender: 'agent' },
    });
    await t.app.get(MessagingService).sendArticle(art.id, false);
    expect(sent.at(-1)).toEqual({ to: '+525511112222', body: 'Te llamamos en 5 minutos' });
    await postSms({ MessageSid: 'SM' + 'd'.repeat(32), MessageStatus: 'delivered' });
    expect(
      (await t.prisma.article.findUniqueOrThrow({ where: { id: art.id } })).deliveryStatus,
    ).toBe('delivered');
    // A phone ticket has no SMS conversation to reply to.
    const other = (
      await agent.post('/api/v1/tickets', {
        title: 'Llamada',
        groupId: GROUP_N2,
        customerId,
        article: { type: 'phone', body: 'x' },
      })
    ).json();
    expect(
      (await agent.post(`/api/v1/tickets/${other.id}/articles`, { type: 'sms', body: 'x' }))
        .statusCode,
    ).toBe(400);
  });
});
