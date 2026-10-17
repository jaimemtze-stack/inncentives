import { Injectable } from '@nestjs/common';
import { ConditionSchema } from '@mesa/shared';
import type { Prisma } from '@prisma/client';
import { AppError } from '../common/errors';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { toTicketWhere } from '../rules/conditions';
import { TicketAccessService } from '../tickets/access.service';

/** Sortable columns; anything else falls back to updated_at. */
const ORDER_COLUMNS: Record<string, keyof Prisma.TicketOrderByWithRelationInput> = {
  number: 'number',
  title: 'title',
  state: 'state',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  escalation_at: 'escalationAt',
  pending_until: 'pendingUntil',
  last_customer_contact_at: 'lastCustomerContactAt',
};

const NULLABLE = new Set(['escalationAt', 'pendingUntil', 'lastCustomerContactAt']);

const listSelect = {
  id: true,
  number: true,
  title: true,
  state: true,
  channel: true,
  createdAt: true,
  updatedAt: true,
  escalationAt: true,
  slaWarningAt: true,
  pendingUntil: true,
  sensitiveData: true,
  unverifiedFrom: true,
  priority: { select: { id: true, name: true, rank: true } },
  group: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true } },
  organization: { select: { id: true, name: true } },
} satisfies Prisma.TicketSelect;

@Injectable()
export class OverviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
  ) {}

  private async where(
    actor: AuthenticatedUser,
    conditions: unknown,
  ): Promise<Prisma.TicketWhereInput> {
    const parsed = ConditionSchema.safeParse(conditions);
    if (!parsed.success) throw new AppError('internal_error', 'Invalid overview definition.');
    const scope = await this.access.scope(actor, 'overview');
    return {
      AND: [scope, toTicketWhere(parsed.data, { currentUserId: actor.id, now: new Date() })],
    };
  }

  async list(actor: AuthenticatedUser) {
    const rows = await this.prisma.overview.findMany({
      where: { active: true, roles: { has: actor.role } },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    return Promise.all(
      rows.map(async (o) => ({
        slug: o.slug,
        name: o.name,
        columns: o.columns,
        count: await this.prisma.ticket.count({ where: await this.where(actor, o.conditions) }),
      })),
    );
  }

  async tickets(
    actor: AuthenticatedUser,
    q: { overview?: string; cursor?: string; limit: number },
  ) {
    const slug = q.overview ?? (actor.role === 'CUSTOMER' ? 'mis-abiertos' : 'abiertos');
    const o = await this.prisma.overview.findFirst({
      where: { slug, active: true, roles: { has: actor.role } },
    });
    if (!o) throw new AppError('not_found');
    if (q.cursor && !/^[0-9a-f-]{36}$/.test(q.cursor)) throw new AppError('validation_failed');
    const col = ORDER_COLUMNS[o.orderBy] ?? 'updatedAt';
    const dir = o.orderDir === 'asc' ? 'asc' : 'desc';
    const rows = await this.prisma.ticket.findMany({
      where: await this.where(actor, o.conditions),
      orderBy: [{ [col]: NULLABLE.has(col) ? { sort: dir, nulls: 'last' } : dir }, { id: 'asc' }],
      select: listSelect,
      take: q.limit + 1,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });
    const hasMore = rows.length > q.limit;
    const items = (hasMore ? rows.slice(0, q.limit) : rows).map((t) =>
      this.access.isStaff(actor)
        ? t
        : {
            id: t.id,
            number: t.number,
            title: t.title,
            state: t.state,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            customer: t.customer,
            priority: { name: t.priority.name, rank: t.priority.rank },
          },
    );
    return {
      overview: { slug: o.slug, name: o.name, columns: o.columns },
      items,
      nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
    };
  }
}
