import { Injectable } from '@nestjs/common';
import type { LinkType } from '@mesa/shared';
import { AppError } from '../common/errors';
import type { AuthenticatedUser } from '../common/request-context';
import { DomainEvents } from '../events/ticket-events';
import { PrismaService } from '../prisma/prisma.service';
import { TicketAccessService } from './access.service';
import { agentTicketDto, articleDto, customerTicketDto, ticketDetailInclude } from './dto';
import { TicketService } from './ticket.service';

const INVERSE: Record<LinkType, LinkType> = {
  parent: 'child',
  child: 'parent',
  related: 'related',
};

/** Ticket reads and the smaller ticket features (links, checklist, time, drafts). */
@Injectable()
export class TicketExtrasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
    private readonly tickets: TicketService,
    private readonly events: DomainEvents,
  ) {}

  /**
   * Opening a ticket in the agent UI: groups with auto-assignment give an
   * unowned new/open ticket to the first agent who opens it.
   */
  async open(actor: AuthenticatedUser, id: string) {
    const t = await this.access.load(actor, id, 'read', { group: true });
    if (
      this.access.isStaff(actor) &&
      t.group.autoAssign &&
      !t.ownerId &&
      (t.state === 'new' || t.state === 'open') &&
      (await this.access.canInGroup(actor, t.groupId, 'change'))
    ) {
      await this.tickets.applyChanges(id, { ownerId: actor.id }, { actorId: actor.id });
    }
    return this.get(actor, id);
  }

  async get(actor: AuthenticatedUser, id: string) {
    const t = await this.access.load(actor, id, 'read', ticketDetailInclude);
    if (!this.access.isStaff(actor))
      return customerTicketDto(t, await this.tickets.ticketAttributes());
    const [subscribed, canChange] = await Promise.all([
      this.prisma.subscription.findUnique({
        where: { ticketId_userId: { ticketId: id, userId: actor.id } },
      }),
      this.access.canInGroup(actor, t.groupId, 'change'),
    ]);
    return {
      ...agentTicketDto(t),
      subscribed: !!subscribed,
      canChange: canChange || t.ownerId === actor.id,
    };
  }

  async articles(actor: AuthenticatedUser, id: string) {
    await this.access.load(actor, id, 'read');
    const staff = this.access.isStaff(actor);
    const rows = await this.prisma.article.findMany({
      where: { ticketId: id, ...(staff ? {} : { internal: false }) },
      orderBy: { createdAt: 'asc' },
      include: { attachments: true },
      take: 1000,
    });
    const authorIds = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
    const authors = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u]),
    );
    return rows.map((a) =>
      articleDto(
        { ...a, createdBy: a.createdById ? authors.get(a.createdById) : null },
        staff ? 'agent' : 'customer',
      ),
    );
  }

  async history(actor: AuthenticatedUser, id: string) {
    await this.access.load(actor, id, 'read');
    const rows = await this.prisma.ticketHistory.findMany({
      where: { ticketId: id },
      orderBy: { id: 'asc' },
      take: 2000,
    });
    const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    return rows.map((r) => ({
      id: r.id.toString(),
      field: r.field,
      oldValue: r.oldValue,
      newValue: r.newValue,
      actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
      createdAt: r.createdAt,
    }));
  }

  // ------------------------------------------------------------------ links

  async links(actor: AuthenticatedUser, id: string) {
    await this.access.load(actor, id, 'read');
    const scope = await this.access.scope(actor, 'read');
    const [out, inc] = await Promise.all([
      this.prisma.ticketLink.findMany({
        where: { sourceId: id, target: scope },
        include: { target: true },
      }),
      this.prisma.ticketLink.findMany({
        where: { targetId: id, source: scope },
        include: { source: true },
      }),
    ]);
    const brief = (t: { id: string; number: string; title: string; state: string }) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      state: t.state,
    });
    return [
      ...out.map((l) => ({ type: l.type, ticket: brief(l.target) })),
      ...inc.map((l) => ({ type: INVERSE[l.type as LinkType], ticket: brief(l.source) })),
    ];
  }

  async addLink(actor: AuthenticatedUser, id: string, targetId: string, type: LinkType) {
    if (id === targetId) throw new AppError('validation_failed', 'A ticket cannot link to itself.');
    await this.access.load(actor, id, 'change');
    await this.access.load(actor, targetId, 'read');
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketLink.deleteMany({
        where: {
          OR: [
            { sourceId: id, targetId },
            { sourceId: targetId, targetId: id },
          ],
        },
      });
      await tx.ticketLink.create({ data: { sourceId: id, targetId, type } });
      await tx.ticketHistory.create({
        data: { ticketId: id, actorId: actor.id, field: 'link', newValue: `${type}:${targetId}` },
      });
    });
  }

  async removeLink(actor: AuthenticatedUser, id: string, targetId: string) {
    await this.access.load(actor, id, 'change');
    const n = await this.prisma.ticketLink.deleteMany({
      where: {
        OR: [
          { sourceId: id, targetId },
          { sourceId: targetId, targetId: id },
        ],
      },
    });
    if (!n.count) throw new AppError('not_found');
    await this.prisma.ticketHistory.create({
      data: { ticketId: id, actorId: actor.id, field: 'link', oldValue: targetId },
    });
  }

  // -------------------------------------------------------------- checklist

  async checklist(actor: AuthenticatedUser, id: string) {
    await this.access.load(actor, id, 'read');
    return this.prisma.checklistItem.findMany({
      where: { ticketId: id },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async addChecklistItem(actor: AuthenticatedUser, id: string, text: string) {
    await this.access.load(actor, id, 'change');
    const count = await this.prisma.checklistItem.count({ where: { ticketId: id } });
    if (count >= 100) throw new AppError('validation_failed', 'Checklist is full.');
    const item = await this.prisma.checklistItem.create({
      data: { ticketId: id, text, position: count },
    });
    this.touch(id, actor.id);
    return item;
  }

  async updateChecklistItem(
    actor: AuthenticatedUser,
    id: string,
    itemId: string,
    patch: { text?: string; done?: boolean },
  ) {
    await this.access.load(actor, id, 'change');
    const res = await this.prisma.checklistItem.updateMany({
      where: { id: itemId, ticketId: id },
      data: {
        ...(patch.text !== undefined ? { text: patch.text } : {}),
        ...(patch.done !== undefined
          ? { done: patch.done, doneById: patch.done ? actor.id : null }
          : {}),
      },
    });
    if (!res.count) throw new AppError('not_found');
    this.touch(id, actor.id);
  }

  async deleteChecklistItem(actor: AuthenticatedUser, id: string, itemId: string) {
    await this.access.load(actor, id, 'change');
    const res = await this.prisma.checklistItem.deleteMany({ where: { id: itemId, ticketId: id } });
    if (!res.count) throw new AppError('not_found');
    this.touch(id, actor.id);
  }

  // ---------------------------------------------------------- time tracking

  async timeEntries(actor: AuthenticatedUser, id: string) {
    await this.access.load(actor, id, 'read');
    const rows = await this.prisma.timeEntry.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: 'asc' },
      include: { activityType: { select: { name: true } } },
    });
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    return rows.map((r) => ({
      id: r.id,
      minutes: r.minutes,
      billable: r.billable,
      activity: r.activityType?.name ?? null,
      userName: names.get(r.userId) ?? null,
      articleId: r.articleId,
      createdAt: r.createdAt,
    }));
  }

  async addTimeEntry(
    actor: AuthenticatedUser,
    id: string,
    t: { minutes: number; activityTypeId?: string; billable: boolean },
  ) {
    await this.access.load(actor, id, 'change');
    if (
      t.activityTypeId &&
      !(await this.prisma.activityType.findFirst({ where: { id: t.activityTypeId, active: true } }))
    ) {
      throw new AppError('validation_failed', 'Unknown activity.', [
        { path: 'activityTypeId', code: 'invalid' },
      ]);
    }
    await this.prisma.$transaction([
      this.prisma.timeEntry.create({
        data: {
          ticketId: id,
          userId: actor.id,
          minutes: t.minutes,
          activityTypeId: t.activityTypeId ?? null,
          billable: t.billable,
        },
      }),
      this.prisma.ticket.update({
        where: { id },
        data: { timeSpentMinutes: { increment: t.minutes } },
      }),
    ]);
  }

  // ------------------------------------------------------------ subscriptions

  async subscribe(actor: AuthenticatedUser, id: string, on: boolean) {
    await this.access.load(actor, id, 'read');
    if (on) {
      await this.prisma.subscription.upsert({
        where: { ticketId_userId: { ticketId: id, userId: actor.id } },
        create: { ticketId: id, userId: actor.id },
        update: {},
      });
    } else {
      await this.prisma.subscription.deleteMany({ where: { ticketId: id, userId: actor.id } });
    }
  }

  // ----------------------------------------------------------- shared draft

  async draft(actor: AuthenticatedUser, id: string) {
    await this.access.load(actor, id, 'change');
    const d = await this.prisma.sharedDraft.findFirst({
      where: { ticketId: id },
      orderBy: { updatedAt: 'desc' },
    });
    return d
      ? { body: d.body, meta: d.meta, updatedAt: d.updatedAt, createdById: d.createdById }
      : null;
  }

  async saveDraft(
    actor: AuthenticatedUser,
    id: string,
    body: string,
    meta: Record<string, unknown> = {},
  ) {
    await this.access.load(actor, id, 'change');
    await this.prisma.$transaction([
      this.prisma.sharedDraft.deleteMany({ where: { ticketId: id } }),
      this.prisma.sharedDraft.create({
        data: { ticketId: id, createdById: actor.id, body, meta: meta as object },
      }),
    ]);
    this.touch(id, actor.id);
  }

  async deleteDraft(actor: AuthenticatedUser, id: string) {
    await this.access.load(actor, id, 'change');
    await this.prisma.sharedDraft.deleteMany({ where: { ticketId: id } });
  }

  private touch(ticketId: string, actorId: string) {
    void this.prisma.ticket
      .findUnique({ where: { id: ticketId } })
      .then((t) => {
        if (t) {
          this.events.emit({
            type: 'ticket.updated',
            ticketId,
            groupId: t.groupId,
            customerId: t.customerId,
            organizationId: t.organizationId,
            actorId,
            internal: true,
          });
        }
      })
      // Best-effort notification: a failed lookup must not become an unhandled rejection.
      .catch(() => undefined);
  }

  /** Other recent tickets of the same customer (agent sidebar). */
  async recentOfCustomer(actor: AuthenticatedUser, id: string) {
    const t = await this.access.load(actor, id, 'read');
    if (!t.customerId) return [];
    const scope = await this.access.scope(actor, 'read');
    return this.prisma.ticket.findMany({
      where: { AND: [scope, { customerId: t.customerId }, { NOT: { id } }] },
      select: { id: true, number: true, title: true, state: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
  }

  /** Time accounted per organization in a month (UTC month boundaries, readable tickets only). */
  async timeSummary(actor: AuthenticatedUser, month: string) {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const scope = await this.access.scope(actor, 'read');
    const entries = await this.prisma.timeEntry.findMany({
      where: { createdAt: { gte: from, lt: to }, ticket: scope },
      select: {
        minutes: true,
        billable: true,
        ticket: {
          select: { organization: { select: { id: true, name: true, supportPlan: true } } },
        },
      },
      take: 50_000,
    });
    const byOrg = new Map<
      string,
      {
        organization: string;
        minutes: number;
        billableMinutes: number;
        includedMinutes: number | null;
      }
    >();
    for (const e of entries) {
      const org = e.ticket.organization;
      const key = org?.id ?? 'none';
      const row = byOrg.get(key) ?? {
        organization: org?.name ?? '—',
        minutes: 0,
        billableMinutes: 0,
        includedMinutes: org?.supportPlan?.includedMinutesPerMonth ?? null,
      };
      row.minutes += e.minutes;
      if (e.billable) row.billableMinutes += e.minutes;
      byOrg.set(key, row);
    }
    return [...byOrg.values()].sort((a, b) => b.minutes - a.minutes);
  }
}
