import { Inject, Injectable, Logger } from '@nestjs/common';
import { ActionsSchema, ConditionSchema, OpenStates } from '@mesa/shared';
import { AuditService } from '../audit/audit.service';
import { SlaService } from '../automation/sla.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { toTicketWhere } from '../rules/conditions';
import { STORAGE, type StorageProvider } from '../storage/storage.provider';
import { TicketService } from '../tickets/ticket.service';

const DAY = 86_400_000;

/** Periodic work run by the jobs process (each task is idempotent). */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketService,
    private readonly sla: SlaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    @Inject(STORAGE) private readonly storage: StorageProvider,
  ) {}

  /** Records each SLA warning/breach once and notifies owner or group (and admins on breach). */
  async slaCheck(now = new Date()): Promise<number> {
    const due = await this.prisma.ticket.findMany({
      where: {
        state: { in: [...OpenStates] },
        OR: [{ slaWarningAt: { lte: now } }, { escalationAt: { lte: now } }],
      },
      take: 500,
    });
    let n = 0;
    for (const t of due) {
      const events: Array<{ kind: 'sla_warning' | 'sla_breach'; at: Date }> = [];
      if (t.escalationAt && t.escalationAt <= now)
        events.push({ kind: 'sla_breach', at: t.escalationAt });
      else if (t.slaWarningAt && t.slaWarningAt <= now)
        events.push({ kind: 'sla_warning', at: t.slaWarningAt });
      for (const e of events) {
        const created = await this.prisma.ticketSlaEvent.createMany({
          data: [{ ticketId: t.id, kind: e.kind, dueAt: e.at }],
          skipDuplicates: true,
        });
        if (!created.count) continue;
        n++;
        const recipients = new Set(
          t.ownerId ? [t.ownerId] : await this.notifications.groupMembers(t.groupId),
        );
        if (e.kind === 'sla_breach') {
          for (const id of await this.notifications.groupMembers(t.groupId)) recipients.add(id);
          const admins = await this.prisma.user.findMany({
            where: { role: 'ADMIN', status: 'ACTIVE' },
            select: { id: true },
          });
          admins.forEach((a) => recipients.add(a.id));
        }
        const label = e.kind === 'sla_breach' ? 'SLA vencido' : 'SLA en riesgo';
        await this.notifications.notify(recipients, t, e.kind, `${label}: #${t.number} ${t.title}`);
      }
    }
    return n;
  }

  /** Pending reminders notify the owner; pending close turns into closed. */
  async pendingCheck(now = new Date()): Promise<void> {
    const reached = await this.prisma.ticket.findMany({
      where: { state: { in: ['pending_reminder', 'pending_close'] }, pendingUntil: { lte: now } },
      take: 500,
    });
    for (const t of reached) {
      if (t.state === 'pending_close') {
        await this.tickets
          .applyChanges(t.id, { state: 'closed' }, { actorId: null })
          .catch((err: Error) => this.logger.warn(`auto-close ${t.number}: ${err.message}`));
        continue;
      }
      const created = await this.prisma.ticketSlaEvent.createMany({
        data: [{ ticketId: t.id, kind: 'reminder', dueAt: t.pendingUntil! }],
        skipDuplicates: true,
      });
      if (created.count) {
        const to = t.ownerId ? [t.ownerId] : await this.notifications.groupMembers(t.groupId);
        await this.notifications.notify(
          to,
          t,
          'reminder_reached',
          `Recordatorio: #${t.number} ${t.title}`,
        );
      }
    }
  }

  /** Runs due schedulers (interval and, optionally, business hours only). */
  async runSchedulers(now = new Date()): Promise<void> {
    const rows = await this.prisma.scheduler.findMany({ where: { active: true } });
    for (const s of rows) {
      if (s.lastRunAt && s.lastRunAt.getTime() + s.intervalMinutes * 60_000 > now.getTime())
        continue;
      if (s.calendarId) {
        const cal = await this.sla.calendar(s.calendarId);
        if (cal.businessMinutesBetween(now, new Date(now.getTime() + 60_000)) === 0) continue;
      }
      const cond = ConditionSchema.safeParse(s.conditions);
      const actions = ActionsSchema.safeParse(s.actions);
      await this.prisma.scheduler.update({ where: { id: s.id }, data: { lastRunAt: now } });
      if (!cond.success || !actions.success) {
        this.logger.error(`scheduler ${s.name} has an invalid definition`);
        continue;
      }
      const ids = await this.prisma.ticket.findMany({
        where: { AND: [toTicketWhere(cond.data, { now }), { state: { not: 'merged' } }] },
        select: { id: true },
        take: s.limitPerRun,
        orderBy: { updatedAt: 'asc' },
      });
      for (const { id } of ids) {
        await this.tickets
          .applyActions(id, actions.data, { actorId: null })
          .catch((err: Error) => this.logger.warn(`scheduler ${s.name} on ${id}: ${err.message}`));
      }
      if (ids.length) this.logger.log(`scheduler ${s.name}: ${ids.length} ticket(s)`);
    }
  }

  /** Drops staged uploads never attached to an article. */
  async cleanupStaged(now = new Date()): Promise<void> {
    const old = await this.prisma.attachment.findMany({
      where: { articleId: null, deletedAt: null, createdAt: { lt: new Date(now.getTime() - DAY) } },
      take: 500,
    });
    for (const a of old) {
      await this.storage.deleteObject(a.storageKey).catch(() => undefined);
      await this.prisma.attachment.update({ where: { id: a.id }, data: { deletedAt: now } });
    }
  }

  /** Retention policies; all disabled until an administrator configures them. */
  async retention(now = new Date()): Promise<void> {
    const policies = await this.prisma.retentionPolicy.findMany({ where: { active: true } });
    for (const p of policies) {
      const before = new Date(now.getTime() - p.days * DAY);
      let affected = 0;
      if (p.target === 'attachments_closed_tickets') {
        const atts = await this.prisma.attachment.findMany({
          where: { deletedAt: null, ticket: { state: 'closed', closedAt: { lt: before } } },
          take: 1000,
        });
        for (const a of atts) {
          await this.storage.deleteObject(a.storageKey).catch(() => undefined);
          await this.prisma.attachment.update({ where: { id: a.id }, data: { deletedAt: now } });
        }
        affected = atts.length;
      } else if (p.target === 'anonymize_closed_tickets') {
        const tickets = await this.prisma.ticket.findMany({
          where: { state: 'closed', closedAt: { lt: before }, NOT: { title: '[anonimizado]' } },
          select: { id: true },
          take: 200,
        });
        for (const t of tickets) await this.anonymizeTicket(t.id, now);
        affected = tickets.length;
      }
      await this.prisma.retentionPolicy.update({ where: { id: p.id }, data: { lastRunAt: now } });
      if (affected) {
        await this.audit.record({
          actorType: 'system',
          action: 'retention.applied',
          targetType: 'retention_policy',
          targetId: p.id,
          data: { target: p.target, affected },
        });
      }
    }
  }

  async anonymizeTicket(ticketId: string, now = new Date()): Promise<void> {
    const atts = await this.prisma.attachment.findMany({ where: { ticketId, deletedAt: null } });
    for (const a of atts) await this.storage.deleteObject(a.storageKey).catch(() => undefined);
    await this.prisma.$transaction([
      this.prisma.attachment.updateMany({
        where: { ticketId },
        data: { deletedAt: now, filename: 'anonimizado' },
      }),
      this.prisma.article.updateMany({
        where: { ticketId },
        data: {
          bodyHtml: '<p>[anonimizado]</p>',
          bodyText: '[anonimizado]',
          subject: null,
          fromAddress: null,
          toAddresses: null,
          ccAddresses: null,
          callNumber: null,
          sensitiveData: false,
          redactedAt: now,
        },
      }),
      this.prisma.sharedDraft.deleteMany({ where: { ticketId } }),
      this.prisma.ticket.update({
        where: { id: ticketId },
        data: {
          title: '[anonimizado]',
          customFields: {},
          unverifiedFrom: null,
          sensitiveData: false,
        },
      }),
    ]);
  }
}
