import { validateCondition, type ConditionNode } from '@mesa/shared';
import { describe, expect, it } from 'vitest';
import { evaluate, toTicketWhere, type RuleContext, type TicketSnapshot } from './conditions';

const ticket: TicketSnapshot = {
  number: '202610180001',
  title: 'Error en cálculo de bono',
  state: 'open',
  priorityId: 'p3',
  groupId: 'g1',
  ownerId: 'u1',
  customerId: 'c1',
  organizationId: 'o1',
  tags: ['nomina', 'urgente'],
  channel: 'email',
  pendingUntil: null,
  escalationAt: new Date('2026-10-18T15:00:00Z'),
  createdAt: new Date('2026-10-18T10:00:00Z'),
  updatedAt: new Date('2026-10-18T10:00:00Z'),
  lastCustomerContactAt: null,
  sensitiveData: false,
  customFields: { inncentives_module: 'planes' },
};
const ctx: RuleContext = {
  ticket,
  now: new Date('2026-10-18T16:00:00Z'),
  currentUserId: 'u1',
  article: {
    type: 'email',
    sender: 'customer',
    internal: false,
    from: 'ana@acme.mx',
    subject: 'Ayuda',
    bodyText: 'El bono no cuadra',
  },
  customer: { email: 'ana@acme.mx' },
  organization: { supportPlanId: 'plan-gold' },
};
const and = (...conditions: ConditionNode[]): ConditionNode => ({ op: 'and', conditions });

describe('evaluate', () => {
  it('matches basic operators', () => {
    expect(evaluate({ field: 'ticket.state', operator: 'is', value: 'open' }, ctx)).toBe(true);
    expect(evaluate({ field: 'ticket.state', operator: 'in', value: ['new', 'open'] }, ctx)).toBe(
      true,
    );
    expect(evaluate({ field: 'ticket.title', operator: 'contains', value: 'CÁLCULO' }, ctx)).toBe(
      true,
    );
    expect(evaluate({ field: 'ticket.owner_id', operator: 'is', value: 'current_user' }, ctx)).toBe(
      true,
    );
    expect(evaluate({ field: 'ticket.pending_until', operator: 'not_set' }, ctx)).toBe(true);
    expect(
      evaluate(
        { field: 'ticket.tags', operator: 'contains_all', value: ['nomina', 'URGENTE'] },
        ctx,
      ),
    ).toBe(true);
    expect(evaluate({ field: 'ticket.tags', operator: 'contains_none', value: ['vip'] }, ctx)).toBe(
      true,
    );
    expect(
      evaluate({ field: 'ticket.custom.inncentives_module', operator: 'is', value: 'planes' }, ctx),
    ).toBe(true);
    expect(
      evaluate({ field: 'organization.support_plan_id', operator: 'is', value: 'plan-gold' }, ctx),
    ).toBe(true);
    expect(evaluate({ field: 'article.from', operator: 'ends_with', value: '@acme.mx' }, ctx)).toBe(
      true,
    );
  });

  it('handles relative dates against "now"', () => {
    expect(
      evaluate(
        { field: 'ticket.escalation_at', operator: 'before_relative', value: { minutes: 0 } },
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluate(
        { field: 'ticket.created_at', operator: 'after_relative', value: { minutes: -60 } },
        ctx,
      ),
    ).toBe(false);
  });

  it('combines groups and treats an empty AND as true', () => {
    expect(evaluate(and(), ctx)).toBe(true);
    expect(
      evaluate(
        {
          op: 'or',
          conditions: [
            { field: 'ticket.state', operator: 'is', value: 'closed' },
            { field: 'ticket.channel', operator: 'is', value: 'email' },
          ],
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluate(
        and(
          { field: 'ticket.state', operator: 'is', value: 'open' },
          { field: 'ticket.channel', operator: 'is', value: 'phone' },
        ),
        ctx,
      ),
    ).toBe(false);
  });

  it('supports change operators for triggers', () => {
    const changed: RuleContext = { ...ctx, previous: { ...ticket, state: 'new' } };
    expect(evaluate({ field: 'ticket.state', operator: 'changed' }, changed)).toBe(true);
    expect(
      evaluate({ field: 'ticket.state', operator: 'changed_to', value: 'open' }, changed),
    ).toBe(true);
    expect(evaluate({ field: 'ticket.state', operator: 'changed' }, ctx)).toBe(false);
  });
});

describe('validateCondition', () => {
  it('rejects unknown fields, invalid operators and bad enum values', () => {
    const usage = { event: false, queryable: true };
    expect(
      validateCondition({ field: 'ticket.password', operator: 'is', value: 'x' }, usage),
    ).toContain('unknown field ticket.password');
    expect(
      validateCondition({ field: 'ticket.state', operator: 'contains', value: 'x' }, usage)[0],
    ).toMatch(/not valid/);
    expect(
      validateCondition({ field: 'ticket.state', operator: 'is', value: 'hacked' }, usage)[0],
    ).toMatch(/invalid value/);
    expect(
      validateCondition({ field: 'article.body', operator: 'contains', value: 'x' }, usage)[0],
    ).toMatch(/cannot be used here/);
    expect(validateCondition({ field: 'ticket.state', operator: 'changed' }, usage)[0]).toMatch(
      /only works in triggers/,
    );
    expect(
      validateCondition({ field: 'ticket.custom.Bad-Key', operator: 'is', value: 1 }, usage)[0],
    ).toMatch(/unknown field/);
  });

  it('bounds size and depth', () => {
    let deep: ConditionNode = { field: 'ticket.state', operator: 'is', value: 'open' };
    for (let i = 0; i < 6; i++) deep = and(deep);
    expect(validateCondition(deep, { event: true, queryable: false })).toContain(
      'condition nested too deeply',
    );
    const wide = and(
      ...Array.from({ length: 70 }, () => ({
        field: 'ticket.state',
        operator: 'is',
        value: 'open',
      })),
    );
    expect(validateCondition(wide, { event: true, queryable: false })).toContain(
      'condition too large',
    );
  });
});

describe('toTicketWhere', () => {
  it('builds Prisma filters and resolves current_user', () => {
    expect(
      toTicketWhere(
        and(
          { field: 'ticket.owner_id', operator: 'is', value: 'current_user' },
          { field: 'ticket.state', operator: 'in', value: ['new'] },
        ),
        { currentUserId: 'u9' },
      ),
    ).toEqual({
      AND: [{ ownerId: 'u9' }, { state: { in: ['new'] } }],
    });
    expect(toTicketWhere({ field: 'ticket.title', operator: 'contains', value: 'bono' })).toEqual({
      title: { contains: 'bono', mode: 'insensitive' },
    });
    expect(
      toTicketWhere({ field: 'ticket.tags', operator: 'contains_one', value: ['A', 'b'] }),
    ).toEqual({ tags: { some: { name: { in: ['a', 'b'] } } } });
    const rel = toTicketWhere(
      { field: 'ticket.pending_until', operator: 'before_relative', value: { minutes: 0 } },
      { now: new Date('2026-01-01T00:00:00Z') },
    );
    expect(rel).toEqual({ pendingUntil: { lt: new Date('2026-01-01T00:00:00Z') } });
  });

  it('refuses fields that cannot be queried', () => {
    expect(() =>
      toTicketWhere({ field: 'article.body', operator: 'contains', value: 'x' }),
    ).toThrow(/not queryable/);
  });
});
