import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AttachmentsService } from '../src/attachments/attachments.service';
import { loadConfig } from '../src/config/config';
import { MaintenanceService } from '../src/jobs/maintenance.service';
import { JobsModule } from '../src/jobs/jobs.module';
import { safePost } from '../src/jobs/safe-fetch';
import { ScanService } from '../src/jobs/scan.service';
import { WebhookCallerService, webhookSecretAad } from '../src/jobs/webhook-caller.service';
import { PrivacyService } from '../src/privacy/privacy.service';
import { zipEntries } from '../src/privacy/zip';
import { JobQueuesService } from '../src/queue/job-queues.service';
import { FieldEncryption } from '../src/security/field-encryption';
import { STORAGE, type StorageProvider } from '../src/storage/storage.provider';
import { TicketService } from '../src/tickets/ticket.service';
import { GROUP_N1, makeOrg, makeUser, startApp, type TestApp } from './helpers';

let t: TestApp;
let jobs: INestApplicationContext;
let tickets: TicketService;
let maintenance: MaintenanceService;
let customerId: string;
let agentId: string;
const posted: Array<{ url: string; body: string; headers: Record<string, string> }> = [];

async function newTicket(title = 'Caso') {
  return tickets.createCore(
    {
      title,
      groupId: GROUP_N1,
      state: 'open',
      channel: 'agent',
      customerId,
      article: { type: 'note', sender: 'agent', internal: false, body: 'texto', isHtml: false },
    },
    { actorId: agentId },
  );
}

beforeAll(async () => {
  t = await startApp();
  jobs = await NestFactory.createApplicationContext(
    JobsModule.forRoot(loadConfig(), { runner: false }),
    { logger: false },
  );
  vi.spyOn(jobs.get(JobQueuesService), 'scan').mockResolvedValue();
  vi.spyOn(jobs.get(JobQueuesService), 'outbound').mockResolvedValue();
  tickets = jobs.get(TicketService);
  maintenance = jobs.get(MaintenanceService);
  const org = await makeOrg(t.prisma);
  const internal = await makeOrg(t.prisma, { internal: true });
  customerId = (await makeUser(t.prisma, 'CUSTOMER', org.id)).id;
  agentId = (await makeUser(t.prisma, 'AGENT', internal.id)).id;
  await t.prisma.groupAccess.create({
    data: { userId: agentId, groupId: GROUP_N1, levels: ['full'] },
  });
});
afterAll(async () => {
  await jobs?.close();
  await t.close();
});

describe('jobs', () => {
  it('scans attachments: infected files are quarantined and reported', async () => {
    const id = await newTicket('Con adjunto');
    const att = jobs.get(AttachmentsService);
    const scanner = jobs.get(ScanService);
    const ok = await att.store({
      buffer: Buffer.from('nombre,salario\nAna,1'),
      filename: 'nomina.csv',
      uploadedById: null,
      ticketId: id,
    });
    const bad = await att.store({
      buffer: Buffer.from('X5O!P%@AP'),
      filename: 'virus.txt',
      uploadedById: null,
      ticketId: id,
    });
    if (!ok.ok || !bad.ok) throw new Error('store failed');
    const scan = vi.spyOn(scanner, 'virusScan');
    scan.mockResolvedValueOnce({ status: 'clean' });
    scan.mockResolvedValueOnce({ status: 'infected', signature: 'Eicar-Test-Signature' });
    const cfg = (scanner as unknown as { config: { CLAMAV_HOST?: string } }).config;
    cfg.CLAMAV_HOST = 'clamd.test';
    await scanner.scan(ok.attachment.id, false);
    await scanner.scan(bad.attachment.id, false);
    cfg.CLAMAV_HOST = undefined;
    expect(
      await t.prisma.attachment.findUniqueOrThrow({ where: { id: ok.attachment.id } }),
    ).toMatchObject({
      scanStatus: 'clean',
      sensitiveData: true,
    });
    expect(
      await t.prisma.attachment.findUniqueOrThrow({ where: { id: bad.attachment.id } }),
    ).toMatchObject({
      scanStatus: 'infected',
      scanDetail: 'Eicar-Test-Signature',
    });
    expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id } })).sensitiveData).toBe(true);
    const note = await t.prisma.article.findFirst({
      where: { ticketId: id, type: 'note', internal: true },
    });
    expect(note?.bodyText).toMatch(/cuarentena/);
    expect(
      await t.prisma.notification.count({ where: { ticketId: id, userId: agentId } }),
    ).toBeGreaterThan(0);
  });

  it('notifies SLA breaches once and closes reached pending_close tickets', async () => {
    const id = await newTicket('SLA');
    await t.prisma.ticket.update({
      where: { id },
      data: { ownerId: agentId, escalationAt: new Date(Date.now() - 60_000) },
    });
    expect(await maintenance.slaCheck()).toBeGreaterThanOrEqual(1);
    const before = await t.prisma.notification.count({
      where: { ticketId: id, type: 'sla_breach' },
    });
    await maintenance.slaCheck();
    expect(await t.prisma.notification.count({ where: { ticketId: id, type: 'sla_breach' } })).toBe(
      before,
    );

    const p = await newTicket('Pendiente');
    await t.prisma.ticket.update({
      where: { id: p },
      data: { state: 'pending_close', pendingUntil: new Date(Date.now() - 1000) },
    });
    await maintenance.pendingCheck();
    expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id: p } })).state).toBe('closed');
  });

  it('runs schedulers on matching tickets', async () => {
    const id = await newTicket('Viejo');
    await t.prisma.scheduler.create({
      data: {
        name: 'Etiquetar abiertos',
        intervalMinutes: 60,
        conditions: {
          op: 'and',
          conditions: [{ field: 'ticket.title', operator: 'is', value: 'Viejo' }],
        },
        actions: [{ type: 'add_tags', tags: ['revisar'] }],
      },
    });
    await maintenance.runSchedulers();
    expect(
      (await t.prisma.ticketTag.findMany({ where: { ticketId: id } })).map((x) => x.name),
    ).toEqual(['revisar']);
    await t.prisma.scheduler.deleteMany({});
  });

  it('applies retention only when enabled', async () => {
    const id = await newTicket('Retención');
    await t.prisma.ticket.update({
      where: { id },
      data: { state: 'closed', closedAt: new Date(Date.now() - 10 * 86_400_000) },
    });
    await maintenance.retention();
    expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id } })).title).toBe('Retención');
    await t.prisma.retentionPolicy.update({
      where: { target: 'anonymize_closed_tickets' },
      data: { active: true, days: 5 },
    });
    await maintenance.retention();
    await t.prisma.retentionPolicy.update({
      where: { target: 'anonymize_closed_tickets' },
      data: { active: false },
    });
    expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id } })).title).toBe(
      '[anonimizado]',
    );
    expect((await t.prisma.article.findFirstOrThrow({ where: { ticketId: id } })).bodyText).toBe(
      '[anonimizado]',
    );
  });

  it('exports, anonymises and deletes user data', async () => {
    const org = await makeOrg(t.prisma);
    const u = await makeUser(t.prisma, 'CUSTOMER', org.id);
    const saved = customerId;
    customerId = u.id;
    await newTicket('Datos ARCO');
    customerId = saved;
    const privacy = jobs.get(PrivacyService);
    const key = await privacy.export(u.id);
    const storage = jobs.get<StorageProvider>(STORAGE);
    const chunks: Buffer[] = [];
    for await (const c of await storage.getObject(key)) chunks.push(c as Buffer);
    expect(zipEntries(Buffer.concat(chunks)).map((e) => e.name)).toEqual(['datos.json']);

    const v = await makeUser(t.prisma, 'CUSTOMER', org.id);
    await privacy.anonymize(v.id);
    expect(await t.prisma.user.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({
      name: 'Usuario anonimizado',
      status: 'DISABLED',
      phone: null,
    });
    await privacy.deleteCustomer(u.id);
    expect(await t.prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
    expect(await t.prisma.ticket.count({ where: { title: 'Datos ARCO' } })).toBe(0);
  });

  it('calls webhooks with a signed, minimal payload', async () => {
    const caller = jobs.get(WebhookCallerService);
    (caller as unknown as { post: typeof safePost }).post = async (url, body, headers) => {
      posted.push({ url, body, headers });
      return { status: 200, body: '' };
    };
    const hook = await t.prisma.webhook.create({
      data: { name: 'Teams', url: 'https://hooks.example.com/x' },
    });
    await t.prisma.webhook.update({
      where: { id: hook.id },
      data: {
        secretEnc: jobs.get(FieldEncryption).encrypt('hook-secret', webhookSecretAad(hook.id)),
      },
    });
    const id = await newTicket('Webhook');
    await caller.call({ webhookId: hook.id, ticketId: id, triggerId: null });
    expect(posted).toHaveLength(1);
    const payload = JSON.parse(posted[0]!.body);
    expect(payload.ticket.title).toBe('Webhook');
    expect(posted[0]!.body).not.toContain('texto');
    expect(posted[0]!.headers['x-mesa-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect((await t.prisma.webhook.findUniqueOrThrow({ where: { id: hook.id } })).lastStatus).toBe(
      200,
    );
  });
});
