import {
  CURRENT_USER,
  CUSTOM_FIELD_PREFIX,
  isGroup,
  type ConditionNode,
  type LeafCondition,
} from '@mesa/shared';
import { Prisma } from '@prisma/client';

export interface TicketSnapshot {
  number: string;
  title: string;
  state: string;
  priorityId: string;
  groupId: string;
  ownerId: string | null;
  customerId: string | null;
  organizationId: string | null;
  tags: string[];
  channel: string;
  pendingUntil: Date | null;
  escalationAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastCustomerContactAt: Date | null;
  sensitiveData: boolean;
  customFields: Record<string, unknown>;
}

export interface ArticleSnapshot {
  type: string;
  sender: string;
  internal: boolean;
  from: string | null;
  subject: string | null;
  bodyText: string;
}

export interface RuleContext {
  ticket: TicketSnapshot;
  /** Ticket before the change (triggers on update). */
  previous?: TicketSnapshot;
  article?: ArticleSnapshot;
  customer?: { email: string } | null;
  organization?: { supportPlanId: string | null } | null;
  now?: Date;
  currentUserId?: string;
}

function ticketValue(t: TicketSnapshot | undefined, key: string): unknown {
  if (!t) return undefined;
  if (key.startsWith('custom.')) return t.customFields[key.slice(7)];
  switch (key) {
    case 'number': return t.number;
    case 'title': return t.title;
    case 'state': return t.state;
    case 'priority_id': return t.priorityId;
    case 'group_id': return t.groupId;
    case 'owner_id': return t.ownerId;
    case 'customer_id': return t.customerId;
    case 'organization_id': return t.organizationId;
    case 'tags': return t.tags;
    case 'channel': return t.channel;
    case 'pending_until': return t.pendingUntil;
    case 'escalation_at': return t.escalationAt;
    case 'created_at': return t.createdAt;
    case 'updated_at': return t.updatedAt;
    case 'last_customer_contact_at': return t.lastCustomerContactAt;
    case 'sensitive_data': return t.sensitiveData;
    default: return undefined;
  }
}

function fieldValue(field: string, ctx: RuleContext, previous = false): unknown {
  const [scope, ...rest] = field.split('.');
  const key = rest.join('.');
  switch (scope) {
    case 'ticket': return ticketValue(previous ? ctx.previous : ctx.ticket, key);
    case 'article': {
      const a = ctx.article;
      if (!a) return undefined;
      return key === 'body' ? a.bodyText : (a as unknown as Record<string, unknown>)[key];
    }
    case 'customer': return key === 'email' ? ctx.customer?.email : undefined;
    case 'organization': return key === 'support_plan_id' ? ctx.organization?.supportPlanId ?? null : undefined;
    default: return undefined;
  }
}

const norm = (v: unknown) => (v === undefined || v === null ? '' : String(v).toLowerCase());
const resolve = (v: unknown, ctx: RuleContext) => (v === CURRENT_USER ? ctx.currentUserId ?? '__none__' : v);
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function asTime(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' && v) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function evalLeaf(c: LeafCondition, ctx: RuleContext): boolean {
  const actual = fieldValue(c.field, ctx);
  const expected = Array.isArray(c.value) ? c.value.map((v) => resolve(v, ctx)) : resolve(c.value, ctx);
  const now = (ctx.now ?? new Date()).getTime();
  switch (c.operator) {
    case 'is':
      return typeof actual === 'boolean' ? actual === expected : norm(actual) === norm(expected);
    case 'is_not':
      return norm(actual) !== norm(expected);
    case 'in':
      return (expected as unknown[]).map(norm).includes(norm(actual));
    case 'not_in':
      return !(expected as unknown[]).map(norm).includes(norm(actual));
    case 'contains':
      return norm(actual).includes(norm(expected));
    case 'not_contains':
      return !norm(actual).includes(norm(expected));
    case 'starts_with':
      return norm(actual).startsWith(norm(expected));
    case 'ends_with':
      return norm(actual).endsWith(norm(expected));
    case 'is_set':
      return !isEmpty(actual);
    case 'not_set':
      return isEmpty(actual);
    case 'gt':
      return Number(actual) > Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'contains_all': {
      const tags = ((actual as string[]) ?? []).map(norm);
      return (expected as unknown[]).every((t) => tags.includes(norm(t)));
    }
    case 'contains_one': {
      const tags = ((actual as string[]) ?? []).map(norm);
      return (expected as unknown[]).some((t) => tags.includes(norm(t)));
    }
    case 'contains_none': {
      const tags = ((actual as string[]) ?? []).map(norm);
      return !(expected as unknown[]).some((t) => tags.includes(norm(t)));
    }
    case 'before':
    case 'after': {
      const a = asTime(actual);
      const b = asTime(expected);
      if (a === null || b === null) return false;
      return c.operator === 'before' ? a < b : a > b;
    }
    case 'before_relative':
    case 'after_relative': {
      const a = asTime(actual);
      if (a === null) return false;
      const limit = now + ((c.value as { minutes: number }).minutes ?? 0) * 60_000;
      return c.operator === 'before_relative' ? a < limit : a > limit;
    }
    case 'changed':
      return !!ctx.previous && norm(fieldValue(c.field, ctx, true)) !== norm(actual);
    case 'changed_to':
      return !!ctx.previous && norm(fieldValue(c.field, ctx, true)) !== norm(actual) && norm(actual) === norm(expected);
    default:
      return false;
  }
}

/** In-memory evaluation (triggers, SLA selection, core workflows). An empty AND is true. */
export function evaluate(node: ConditionNode | null | undefined, ctx: RuleContext): boolean {
  if (!node) return true;
  if (isGroup(node)) {
    if (node.conditions.length === 0) return true;
    return node.op === 'and'
      ? node.conditions.every((c) => evaluate(c, ctx))
      : node.conditions.some((c) => evaluate(c, ctx));
  }
  return evalLeaf(node, ctx);
}

// ---------------------------------------------------------------- to Prisma

const columnMap: Record<string, keyof Prisma.TicketWhereInput> = {
  'ticket.number': 'number',
  'ticket.title': 'title',
  'ticket.state': 'state',
  'ticket.priority_id': 'priorityId',
  'ticket.group_id': 'groupId',
  'ticket.owner_id': 'ownerId',
  'ticket.customer_id': 'customerId',
  'ticket.organization_id': 'organizationId',
  'ticket.channel': 'channel',
  'ticket.pending_until': 'pendingUntil',
  'ticket.escalation_at': 'escalationAt',
  'ticket.created_at': 'createdAt',
  'ticket.updated_at': 'updatedAt',
  'ticket.last_customer_contact_at': 'lastCustomerContactAt',
  'ticket.sensitive_data': 'sensitiveData',
};

function leafToWhere(c: LeafCondition, opts: { currentUserId?: string; now?: Date }): Prisma.TicketWhereInput {
  const resolveV = (v: unknown) => (v === CURRENT_USER ? opts.currentUserId ?? '00000000-0000-0000-0000-000000000000' : v);
  const value = Array.isArray(c.value) ? c.value.map(resolveV) : resolveV(c.value);
  const now = (opts.now ?? new Date()).getTime();

  if (c.field === 'ticket.tags') {
    const tags = (value as string[]).map((t) => String(t).toLowerCase());
    if (c.operator === 'contains_all') return { AND: tags.map((name) => ({ tags: { some: { name } } })) };
    if (c.operator === 'contains_one') return { tags: { some: { name: { in: tags } } } };
    return { tags: { none: { name: { in: tags } } } };
  }
  if (c.field === 'organization.support_plan_id') {
    if (c.operator === 'is_set') return { organization: { supportPlanId: { not: null } } };
    if (c.operator === 'not_set') return { OR: [{ organizationId: null }, { organization: { supportPlanId: null } }] };
    if (c.operator === 'in') return { organization: { supportPlanId: { in: value as string[] } } };
    if (c.operator === 'not_in') return { NOT: { organization: { supportPlanId: { in: value as string[] } } } };
    if (c.operator === 'is_not') return { NOT: { organization: { supportPlanId: value as string } } };
    return { organization: { supportPlanId: value as string } };
  }
  if (c.field.startsWith(CUSTOM_FIELD_PREFIX)) {
    const path = [c.field.slice(CUSTOM_FIELD_PREFIX.length)];
    switch (c.operator) {
      case 'is': return { customFields: { path, equals: value as Prisma.InputJsonValue } };
      case 'is_not': return { NOT: { customFields: { path, equals: value as Prisma.InputJsonValue } } };
      case 'contains': return { customFields: { path, string_contains: String(value) } };
      case 'is_set': return { NOT: { customFields: { path, equals: Prisma.AnyNull } } };
      case 'not_set': return { customFields: { path, equals: Prisma.AnyNull } };
      default: throw new Error(`Unsupported operator ${c.operator} for custom fields`);
    }
  }
  const col = columnMap[c.field];
  if (!col) throw new Error(`Field ${c.field} is not queryable`);
  const text = (filter: Record<string, unknown>) => ({ [col]: { ...filter, mode: 'insensitive' } });
  switch (c.operator) {
    case 'is': return { [col]: value };
    case 'is_not': return { NOT: { [col]: value } };
    case 'in': return { [col]: { in: value } };
    case 'not_in': return { NOT: { [col]: { in: value } } };
    case 'contains': return text({ contains: String(value) });
    case 'not_contains': return { NOT: text({ contains: String(value) }) };
    case 'starts_with': return text({ startsWith: String(value) });
    case 'ends_with': return text({ endsWith: String(value) });
    case 'is_set': return { NOT: { [col]: null } };
    case 'not_set': return { [col]: null };
    case 'before': return { [col]: { lt: new Date(String(value)) } };
    case 'after': return { [col]: { gt: new Date(String(value)) } };
    case 'before_relative': return { [col]: { lt: new Date(now + (c.value as { minutes: number }).minutes * 60_000) } };
    case 'after_relative': return { [col]: { gt: new Date(now + (c.value as { minutes: number }).minutes * 60_000) } };
    default: throw new Error(`Operator ${c.operator} cannot be queried`);
  }
}


/** Translates a (validated, queryable) condition into a Prisma where clause. */
export function toTicketWhere(
  node: ConditionNode | null | undefined,
  opts: { currentUserId?: string; now?: Date } = {},
): Prisma.TicketWhereInput {
  if (!node) return {};
  if (isGroup(node)) {
    if (node.conditions.length === 0) return {};
    const parts = node.conditions.map((c) => toTicketWhere(c, opts));
    return node.op === 'and' ? { AND: parts } : { OR: parts };
  }
  return leafToWhere(node, opts);
}
