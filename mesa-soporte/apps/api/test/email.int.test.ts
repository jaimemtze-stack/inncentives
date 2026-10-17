import { randomBytes } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailChannel } from '@prisma/client';
import { EmailChannelsService } from '../src/channels/email/email-channels.service';
import { MailIngestService, TRIAGE_GROUP_ID } from '../src/channels/email/ingest.service';
import {
  AGENT,
  Client,
  GROUP_N1,
  grantGroup,
  makeOrg,
  makeUser,
  startApp,
  type TestApp,
} from './helpers';

const GM_HOST = process.env.GREENMAIL_HOST ?? '127.0.0.1';
const TRUSTED = 'mx.mesa.test';

let t: TestApp;
let ingest: MailIngestService;
let channel: EmailChannel;
let customerEmail: string;
let customerId: string;
let agent: Client;

function raw(opts: {
  from: string;
  subject: string;
  body?: string;
  auth?: string | null;
  messageId?: string;
  inReplyTo?: string;
  extra?: string[];
}): Buffer {
  const id = opts.messageId ?? `<${randomBytes(6).toString('hex')}@cliente.mx>`;
  const lines = [
    ...(opts.auth === null
      ? []
      : [`Authentication-Results: ${TRUSTED}; ${opts.auth ?? 'spf=pass; dkim=pass; dmarc=pass'}`]),
    `From: Cliente <${opts.from}>`,
    `To: soporte@mesa.test`,
    `Subject: ${opts.subject}`,
    `Message-ID: ${id}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.extra ?? []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    opts.body ?? 'Hola, tengo un problema.',
  ];
  return Buffer.from(lines.join('\r\n'));
}

beforeAll(async () => {
  t = await startApp();
  ingest = t.app.get(MailIngestService);
  const org = await makeOrg(t.prisma);
  const internal = await makeOrg(t.prisma, { internal: true });
  const c = await makeUser(t.prisma, 'CUSTOMER', org.id);
  const a = await makeUser(t.prisma, 'AGENT', internal.id);
  await grantGroup(t.prisma, a.id, GROUP_N1);
  await grantGroup(t.prisma, a.id, TRIAGE_GROUP_ID);
  customerEmail = c.email;
  customerId = c.id;
  agent = new Client(t.app, AGENT);
  await agent.loginAndEnroll(a.email);
  channel = await t.prisma.emailChannel.create({
    data: {
      name: 'Soporte',
      address: 'soporte@mesa.test',
      adapter: 'imap',
      groupId: GROUP_N1,
      secretName: 'greenmail_password',
      trustedAuthServ: TRUSTED,
      config: {
        host: GM_HOST,
        port: 3143,
        secure: false,
        user: 'soporte@mesa.test',
        insecureTls: true,
        smtp: { host: GM_HOST, port: 3025, secure: false },
      },
    },
  });
  process.env.SECRET_GREENMAIL_PASSWORD = 'cualquiera';
});
afterAll(async () => t.close());

describe('inbound e-mail', () => {
  it('creates a ticket for a verified customer and threads replies', async () => {
    const first = await ingest.ingest(
      channel,
      raw({ from: customerEmail, subject: 'No carga el reporte' }),
    );
    expect(first.action).toBe('created');
    const ticketId = (first as { ticketId: string }).ticketId;
    const ticket = await t.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket).toMatchObject({ customerId, groupId: GROUP_N1, channel: 'email', state: 'new' });

    // Duplicate delivery of the same Message-ID is ignored.
    const again = await ingest.ingest(
      channel,
      raw({ from: customerEmail, subject: 'x', messageId: '<dup@cliente.mx>' }),
    );
    expect(
      (
        await ingest.ingest(
          channel,
          raw({ from: customerEmail, subject: 'x', messageId: '<dup@cliente.mx>' }),
        )
      ).action,
    ).toBe('duplicate');
    expect(again.action).toBe('created');

    // Reply by subject number.
    const reply = await ingest.ingest(
      channel,
      raw({
        from: customerEmail,
        subject: `RE: [Ticket#${ticket.number}] No carga el reporte`,
        body: 'Sigue igual',
      }),
    );
    expect(reply).toEqual({ action: 'appended', ticketId });
    // A subject without the number never threads.
    const unrelated = await ingest.ingest(
      channel,
      raw({ from: customerEmail, subject: 'RE: No carga el reporte' }),
    );
    expect(unrelated.action).toBe('created');
  });

  it('sends unknown or unauthenticated senders to triage without auto-replies', async () => {
    await t.prisma.trigger.create({
      data: {
        name: 'Acuse de recibo',
        event: 'create',
        conditions: {
          op: 'and',
          conditions: [{ field: 'ticket.channel', operator: 'is', value: 'email' }],
        },
        actions: [
          {
            type: 'reply_customer',
            subject: 'Recibimos tu solicitud',
            body: 'Hola {{customer.name}}',
          },
        ],
      },
    });
    const before = t.outbound.length;
    const unknown = await ingest.ingest(
      channel,
      raw({ from: 'desconocido@otro.mx', subject: 'Hola' }),
    );
    const spoofed = await ingest.ingest(
      channel,
      raw({ from: customerEmail, subject: 'Urgente', auth: 'spf=fail; dkim=none; dmarc=fail' }),
    );
    const noAuth = await ingest.ingest(
      channel,
      raw({ from: customerEmail, subject: 'Sin auth', auth: null }),
    );
    for (const r of [unknown, spoofed, noAuth]) {
      const tk = await t.prisma.ticket.findUniqueOrThrow({
        where: { id: (r as { ticketId: string }).ticketId },
      });
      expect(tk).toMatchObject({ groupId: TRIAGE_GROUP_ID, customerId: null });
    }
    expect(t.outbound.length).toBe(before);
    const tk = await t.prisma.ticket.findUniqueOrThrow({
      where: { id: (unknown as { ticketId: string }).ticketId },
    });
    expect(tk.unverifiedFrom).toBe('desconocido@otro.mx');

    // A verified customer gets the acknowledgement, but never for automatic mail.
    await ingest.ingest(channel, raw({ from: customerEmail, subject: 'Con acuse' }));
    expect(t.outbound.length).toBe(before + 1);
    await ingest.ingest(
      channel,
      raw({
        from: customerEmail,
        subject: 'Fuera de oficina',
        extra: ['Auto-Submitted: auto-replied'],
      }),
    );
    expect(t.outbound.length).toBe(before + 1);
    await t.prisma.trigger.deleteMany({});

    // An agent links the triage ticket to the right customer and moves it.
    const linked = await agent.patch(`/api/v1/tickets/${tk.id}`, { customerId, groupId: GROUP_N1 });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({
      unverifiedFrom: null,
      customer: expect.objectContaining({ id: customerId }),
    });
  });

  it('ignores loops and marks bounces on the original article', async () => {
    expect(
      (await ingest.ingest(channel, raw({ from: 'soporte@mesa.test', subject: 'loop' }))).action,
    ).toBe('ignored');
    expect(
      (
        await ingest.ingest(
          channel,
          raw({ from: customerEmail, subject: 'x', extra: ['X-Loop: mesa-soporte'] }),
        )
      ).action,
    ).toBe('ignored');
    const created = await agent.post('/api/v1/tickets', {
      title: 'Aviso',
      groupId: GROUP_N1,
      customerId,
      article: { type: 'email', body: '<p>Hola</p>' },
    });
    const art = await t.prisma.article.findFirstOrThrow({ where: { ticketId: created.json().id } });
    await t.prisma.article.update({
      where: { id: art.id },
      data: { messageId: '<out-1@mesa.test>' },
    });
    const bounce = await ingest.ingest(
      channel,
      raw({
        from: 'MAILER-DAEMON@cliente.mx',
        subject: 'Undeliverable',
        inReplyTo: '<out-1@mesa.test>',
      }),
    );
    expect(bounce.action).toBe('bounce');
    expect(
      (await t.prisma.article.findUniqueOrThrow({ where: { id: art.id } })).deliveryStatus,
    ).toBe('failed');
  });

  it('applies postmaster filters', async () => {
    await t.prisma.postmasterFilter.create({
      data: {
        name: 'Boletines',
        match: [{ header: 'subject', operator: 'starts_with', value: '[boletín]' }],
        set: { ignore: true },
      },
    });
    expect(
      (await ingest.ingest(channel, raw({ from: customerEmail, subject: '[Boletín] Octubre' })))
        .action,
    ).toBe('ignored');
    await t.prisma.postmasterFilter.deleteMany({});
  });
});

describe('mailbox round trip (GreenMail)', () => {
  it('fetches over IMAP and sends replies over SMTP with threading headers', async () => {
    const smtp = nodemailer.createTransport({
      host: GM_HOST,
      port: 3025,
      secure: false,
      ignoreTLS: true,
    });
    await smtp.sendMail({
      from: customerEmail,
      to: 'soporte@mesa.test',
      subject: 'Desde IMAP',
      text: 'Prueba de extremo a extremo',
      headers: { 'Authentication-Results': `${TRUSTED}; dmarc=pass` },
    });
    const svc = t.app.get(EmailChannelsService);
    await svc.fetchAll();
    const ticket = await t.prisma.ticket.findFirstOrThrow({ where: { title: 'Desde IMAP' } });
    expect(ticket.customerId).toBe(customerId);

    const reply = await agent.post(`/api/v1/tickets/${ticket.id}/articles`, {
      type: 'email',
      body: '<p>Respuesta</p>',
    });
    await svc.sendArticle(reply.json().id, true);
    const sent = await t.prisma.article.findUniqueOrThrow({ where: { id: reply.json().id } });
    expect(sent).toMatchObject({ deliveryStatus: 'sent', messageId: `<${sent.id}@mesa.test>` });

    const imap = new ImapFlow({
      host: GM_HOST,
      port: 3143,
      secure: false,
      auth: { user: customerEmail, pass: 'x' },
      logger: false,
    });
    await imap.connect();
    await imap.mailboxOpen('INBOX');
    const msg = await imap.fetchOne('*', { source: true, envelope: true });
    await imap.logout();
    const source = msg ? msg.source!.toString() : '';
    expect(source).toContain(`[Ticket#${ticket.number}]`);
    expect(source).toMatch(/In-Reply-To: </);
    expect(source).toContain('X-Loop: mesa-soporte');

    // The customer's answer comes back into the same ticket through In-Reply-To.
    const answer = await ingest.ingest(
      channel,
      raw({ from: customerEmail, subject: 'Re: algo', inReplyTo: sent.messageId! }),
    );
    expect(answer).toEqual({ action: 'appended', ticketId: ticket.id });
  });
});
