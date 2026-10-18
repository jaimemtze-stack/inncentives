import { Injectable, Logger } from '@nestjs/common';
import type { Ticket } from '@prisma/client';
import { DomainEvents } from '../events/ticket-events';
import { MailService } from '../mail/mail.service';
import { TeamsEvents } from '../integrations/teams';
import { PrismaService } from '../prisma/prisma.service';
import { JobQueuesService } from '../queue/job-queues.service';

export type NotificationKind =
  | 'ticket_created'
  | 'ticket_assigned'
  | 'customer_reply'
  | 'ticket_updated'
  | 'mention'
  | 'reminder_reached'
  | 'sla_warning'
  | 'sla_breach'
  | 'trigger';

/** E-mail defaults when the user has not chosen; in-app is always on. */
const EMAIL_DEFAULTS: Record<NotificationKind, boolean> = {
  ticket_created: false,
  ticket_assigned: true,
  customer_reply: true,
  ticket_updated: false,
  mention: true,
  reminder_reached: true,
  sla_warning: true,
  sla_breach: true,
  trigger: true,
};

const READ_LEVELS = ['full', 'read', 'change'];

interface Prefs {
  email?: Partial<Record<NotificationKind, boolean>>;
}

type TicketRef = Pick<Ticket, 'id' | 'number' | 'title' | 'groupId' | 'ownerId'>;

/**
 * Agent notifications: in-app rows plus optional e-mail. Recipients are
 * filtered to active staff who can read the ticket, so a notification never
 * reveals a ticket to someone outside its group.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly events: DomainEvents,
    private readonly queues: JobQueuesService,
  ) {}

  /** Queues a Teams card for the channels of the ticket group that listen to this event. */
  private async teams(ticket: TicketRef, kind: NotificationKind): Promise<void> {
    if (!(TeamsEvents as readonly string[]).includes(kind)) return;
    const channels = await this.prisma.teamsChannel.findMany({
      where: { groupId: ticket.groupId, active: true, events: { has: kind } },
      select: { id: true },
    });
    for (const c of channels) {
      await this.queues
        .teams({ channelId: c.id, ticketId: ticket.id, event: kind })
        .catch((err: Error) => this.logger.warn(`teams queue: ${err.message}`));
    }
  }

  /** Active agents with read access to the group. */
  async groupMembers(groupId: string): Promise<string[]> {
    const rows = await this.prisma.groupAccess.findMany({
      where: {
        groupId,
        levels: { hasSome: READ_LEVELS },
        user: { status: 'ACTIVE', role: { in: ['ADMIN', 'AGENT'] } },
      },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  async notify(
    userIds: Iterable<string>,
    ticket: TicketRef,
    kind: NotificationKind,
    title: string,
    opts: { excludeUserId?: string | null; emailSubject?: string; emailBody?: string } = {},
  ): Promise<void> {
    await this.teams(ticket, kind);
    const ids = new Set([...userIds].filter((id) => id && id !== opts.excludeUserId));
    if (!ids.size) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] }, status: 'ACTIVE', role: { in: ['ADMIN', 'AGENT'] } },
      include: { groupAccess: { where: { groupId: ticket.groupId } } },
    });
    // Out-of-office agents hand their notifications to their replacement.
    const now = new Date();
    for (const u of users) {
      const away = u.outOfOffice && (!u.outOfOfficeUntil || u.outOfOfficeUntil > now);
      if (away && u.replacementId && !ids.has(u.replacementId)) {
        const rep = await this.prisma.user.findUnique({
          where: { id: u.replacementId },
          include: { groupAccess: { where: { groupId: ticket.groupId } } },
        });
        if (rep && rep.status === 'ACTIVE' && rep.role !== 'CUSTOMER') users.push(rep);
      }
    }
    const link = this.mail.link('agent', `/tickets/${ticket.id}`);
    for (const u of users) {
      const canRead =
        u.role === 'ADMIN' ||
        ticket.ownerId === u.id ||
        u.groupAccess.some((g) => g.levels.some((l) => READ_LEVELS.includes(l)));
      if (!canRead) continue;
      await this.prisma.notification.create({
        data: { userId: u.id, ticketId: ticket.id, type: kind, title: title.slice(0, 300) },
      });
      this.events.emit({ type: 'notification.created', userId: u.id });
      const prefs = (u.notificationPrefs ?? {}) as Prefs;
      const wantsEmail = prefs.email?.[kind] ?? EMAIL_DEFAULTS[kind];
      if (wantsEmail) {
        await this.mail
          .send({
            template: 'ticket_notification',
            to: u.email,
            locale: u.locale,
            params: {
              name: u.name,
              subject: opts.emailSubject ?? `[#${ticket.number}] ${title}`,
              body: opts.emailBody ?? title,
              link,
            },
          })
          .catch((err: Error) => this.logger.error(`notification mail failed: ${err.message}`));
      }
    }
  }

  /** Customer-facing notification e-mail (trigger action "notify customer"). */
  async notifyCustomer(
    customer: { email: string; name: string; locale: string },
    ticket: TicketRef,
    subject: string,
    body: string,
  ): Promise<void> {
    await this.mail.send({
      template: 'ticket_notification',
      to: customer.email,
      locale: customer.locale,
      params: {
        name: customer.name,
        subject,
        body,
        link: this.mail.link('portal', `/tickets/${ticket.id}`),
      },
    });
  }
}
