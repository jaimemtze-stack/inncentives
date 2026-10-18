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

/**
 * Search syntax: free text plus state:, tag:, owner:me|"Name", org:"ACME",
 * group:"Soporte N1" and #number. Quoted values may contain spaces.
 */
export function parseQuery(
  raw: string,
  currentUserId: string,
): { filters: Prisma.TicketWhereInput[]; words: string[] } {
  const filters: Prisma.TicketWhereInput[] = [];
  const words: string[] = [];
  const tokens = raw.trim().match(/[a-zñ]+:"[^"]{1,80}"|"[^"]{1,80}"|\S+/gi) ?? [];
  for (const token of tokens.slice(0, 30)) {
    const m =
      /^(state|estado|tag|etiqueta|owner|propietario|org|organizacion|group|grupo):"?([^"]{1,80})"?$/i.exec(
        token,
      );
    if (m) {
      const key = m[1]!.toLowerCase();
      const v = m[2]!;
      if (key === 'state' || key === 'estado') filters.push({ state: v.toLowerCase() });
      else if (key === 'tag' || key === 'etiqueta')
        filters.push({ tags: { some: { name: v.toLowerCase() } } });
      else if (key === 'owner' || key === 'propietario') {
        filters.push(
          v.toLowerCase() === 'me' || v.toLowerCase() === 'yo'
            ? { ownerId: currentUserId }
            : { owner: { name: { contains: v, mode: 'insensitive' } } },
        );
      } else if (key === 'org' || key === 'organizacion')
        filters.push({ organization: { name: { contains: v, mode: 'insensitive' } } });
      else filters.push({ group: { name: { contains: v, mode: 'insensitive' } } });
    } else if (/^#?\d{12,16}$/.test(token)) {
      filters.push({ number: token.replace('#', '') });
    } else {
      words.push(token.replace(/"/g, ''));
    }
  }
  return { filters, words };
}

type ListRow = Prisma.TicketGetPayload<{ select: typeof listSelect }>;

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
    const items = (hasMore ? rows.slice(0, q.limit) : rows).map((t) => this.listItem(actor, t));
    return {
      overview: { slug: o.slug, name: o.name, columns: o.columns },
      items,
      nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
    };
  }

  private listItem(actor: AuthenticatedUser, t: ListRow) {
    return this.access.isStaff(actor)
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
        };
  }

  /**
   * Full-text search over ticket titles and article bodies, plus filters
   * ("state:open", "tag:carga", "#202610170001"). Matches come from SQL with
   * bound parameters; the ticket policy is applied in the final query, and
   * customers never match on internal notes.
   */
  async search(actor: AuthenticatedUser, raw: string, limit: number) {
    const { filters, words } = parseQuery(raw, actor.id);
    const text = words.join(' ').slice(0, 200);
    if (!text && !filters.length) return { items: [] };
    if (text) {
      const staff = this.access.isStaff(actor);
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        WITH q AS (
          SELECT websearch_to_tsquery('spanish', mesa_unaccent(${text}))
              || websearch_to_tsquery('english', mesa_unaccent(${text}))
              || websearch_to_tsquery('simple', ${text}) AS query
        )
        (SELECT t.id FROM tickets t, q WHERE t.search_vector @@ q.query ORDER BY t.updated_at DESC LIMIT 500)
        UNION
        (SELECT a.ticket_id AS id FROM articles a, q
          WHERE a.search_vector @@ q.query AND (${staff} OR a.internal = false)
          ORDER BY a.created_at DESC LIMIT 500)`;
      filters.push({ id: { in: rows.map((r) => r.id) } });
    }
    const scope = await this.access.scope(actor, 'read');
    const found = await this.prisma.ticket.findMany({
      where: { AND: [scope, ...filters] },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: listSelect,
      take: limit,
    });
    return { items: found.map((t) => this.listItem(actor, t)) };
  }
}
