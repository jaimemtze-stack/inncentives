import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../security/session.service';
import { STORAGE, type StorageProvider } from '../storage/storage.provider';
import { buildZip } from './zip-writer';

export type PrivacyAction = 'export' | 'anonymize' | 'delete';

const MAX_EXPORT_ATTACHMENT_BYTES = 200 * 1024 * 1024;

/**
 * Data subject requests (ARCO / GDPR): export, anonymise or delete a user's
 * data. Requests are created by administrators (audited, with a reason) and
 * processed asynchronously by the jobs service.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    @Inject(STORAGE) private readonly storage: StorageProvider,
  ) {}

  async request(
    req: FastifyRequest,
    input: { userId: string; action: PrivacyAction; reason: string },
  ) {
    const target = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!target) throw new AppError('not_found');
    if (input.action === 'delete' && target.role !== 'CUSTOMER') {
      throw new AppError('validation_failed', 'Staff accounts can only be anonymised.');
    }
    if (target.id === req.auth!.user.id)
      throw new AppError('forbidden', 'You cannot run a privacy task on yourself.');
    const task = await this.prisma.$transaction(async (tx) => {
      const t = await tx.dataPrivacyTask.create({
        data: {
          targetUserId: target.id,
          action: input.action,
          reason: input.reason,
          requestedById: req.auth!.user.id,
        },
      });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: `privacy.${input.action}.requested`,
          targetType: 'user',
          targetId: target.id,
          organizationId: target.organizationId,
          data: { taskId: t.id, reason: input.reason },
        },
        tx,
      );
      return t;
    });
    return task;
  }

  list() {
    return this.prisma.dataPrivacyTask.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async exportUrl(req: FastifyRequest, taskId: string) {
    const task = await this.prisma.dataPrivacyTask.findUnique({ where: { id: taskId } });
    if (!task || task.action !== 'export' || task.status !== 'done' || !task.resultKey)
      throw new AppError('not_found');
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'privacy.export.downloaded',
      targetType: 'user',
      targetId: task.targetUserId,
      data: { taskId },
    });
    return {
      url: await this.storage.createDownloadUrl(
        task.resultKey,
        120,
        `datos-${task.targetUserId}.zip`,
      ),
    };
  }

  /** Processes pending tasks (jobs service). */
  async processPending(): Promise<void> {
    const tasks = await this.prisma.dataPrivacyTask.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });
    for (const t of tasks) {
      try {
        let resultKey: string | null = null;
        if (t.action === 'export') resultKey = await this.export(t.targetUserId);
        else if (t.action === 'anonymize') await this.anonymize(t.targetUserId);
        else if (t.action === 'delete') await this.deleteCustomer(t.targetUserId);
        await this.prisma.dataPrivacyTask.update({
          where: { id: t.id },
          data: { status: 'done', resultKey, completedAt: new Date() },
        });
        await this.audit.record({
          actorType: 'system',
          action: `privacy.${t.action}.completed`,
          targetType: 'user',
          targetId: t.targetUserId,
          data: { taskId: t.id },
        });
      } catch (err) {
        this.logger.error(`privacy task ${t.id} failed: ${(err as Error).message}`);
        await this.prisma.dataPrivacyTask.update({
          where: { id: t.id },
          data: {
            status: 'failed',
            error: (err as Error).message.slice(0, 500),
            completedAt: new Date(),
          },
        });
      }
    }
  }

  private async readObject(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of await this.storage.getObject(key)) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  async export(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        locale: true,
        timezone: true,
        phone: true,
        mobile: true,
        createdAt: true,
        lastLoginAt: true,
        customFields: true,
        organization: { select: { name: true } },
      },
    });
    const tickets = await this.prisma.ticket.findMany({
      where: { customerId: userId },
      include: {
        articles: {
          where: { internal: false },
          orderBy: { createdAt: 'asc' },
          include: { attachments: { where: { deletedAt: null } } },
        },
      },
    });
    const activity = await this.prisma.auditLog.findMany({
      where: { actorUserId: userId },
      select: { occurredAt: true, action: true, ip: true },
      orderBy: { id: 'asc' },
      take: 5000,
    });
    const files: Array<{ name: string; data: Buffer }> = [];
    let budget = MAX_EXPORT_ATTACHMENT_BYTES;
    const ticketData = [];
    for (const t of tickets) {
      const articles = [];
      for (const a of t.articles) {
        const atts = [];
        for (const f of a.attachments) {
          if (!['clean', 'skipped'].includes(f.scanStatus) || f.size > budget) continue;
          budget -= f.size;
          const name = `adjuntos/${t.number}/${f.id}-${f.filename}`;
          files.push({ name, data: await this.readObject(f.storageKey) });
          atts.push(name);
        }
        articles.push({
          createdAt: a.createdAt,
          type: a.type,
          sender: a.sender,
          subject: a.subject,
          body: a.bodyText,
          attachments: atts,
        });
      }
      ticketData.push({
        number: t.number,
        title: t.title,
        state: t.state,
        createdAt: t.createdAt,
        closedAt: t.closedAt,
        articles,
      });
    }
    const json = JSON.stringify(
      { exportedAt: new Date().toISOString(), user, tickets: ticketData, activity },
      null,
      2,
    );
    const zip = buildZip([{ name: 'datos.json', data: Buffer.from(json) }, ...files]);
    const key = `privacy/${randomUUID()}`;
    await this.storage.putObject({
      key,
      body: zip,
      contentType: 'application/zip',
      contentLength: zip.length,
    });
    return key;
  }

  async anonymize(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const alias = `anonimo-${userId.slice(0, 8)}@anon.invalid`;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: alias,
          name: 'Usuario anonimizado',
          phone: null,
          mobile: null,
          status: 'DISABLED',
          passwordHash: '!',
          totpSecretEnc: null,
          totpEnabledAt: null,
          customFields: {},
          notificationPrefs: {},
        },
      }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.article.updateMany({
        where: { fromAddress: user.email },
        data: { fromAddress: alias },
      }),
      this.prisma.ticket.updateMany({
        where: { unverifiedFrom: user.email },
        data: { unverifiedFrom: alias },
      }),
    ]);
    await this.sessions.destroyAll(userId);
  }

  async deleteCustomer(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role !== 'CUSTOMER') throw new Error('Only customers can be deleted');
    const atts = await this.prisma.attachment.findMany({
      where: { ticket: { customerId: userId } },
    });
    for (const a of atts) await this.storage.deleteObject(a.storageKey).catch(() => undefined);
    await this.sessions.destroyAll(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.attachment.deleteMany({ where: { id: { in: atts.map((a) => a.id) } } });
      await tx.ticket.deleteMany({ where: { customerId: userId } });
      await tx.invitation.deleteMany({ where: { email: user.email } });
      await tx.user.delete({ where: { id: userId } });
    });
  }
}
