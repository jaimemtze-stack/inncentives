import { describe, expect, it } from 'vitest';
import type { Actor } from '../auth/actor';
import { PolicyService } from './policy.service';

const policy = new PolicyService();
const base: Actor = {
  userId: 'u1',
  email: 'x',
  roles: [],
  permissions: new Set(),
  organizationIds: [],
  sharedOrganization: false,
  groupLevels: new Map(),
  locale: 'es-MX',
};
const ticket = (
  o: Partial<{ groupId: string; customerId: string; organizationId: string | null }> = {},
) => ({
  groupId: 'g1',
  customerId: 'c1',
  organizationId: 'o1',
  ...o,
});

describe('PolicyService', () => {
  it('denies everything to an actor without ticket permissions (including admins)', () => {
    const admin = {
      ...base,
      permissions: new Set(['admin']),
      groupLevels: new Map([['g1', ['full' as const]]]),
    };
    expect(policy.ticketScope(admin)).toEqual({ OR: [{ id: { in: [] } }] });
    expect(policy.canAccessTicket(admin, ticket())).toBe(false);
  });

  it('agents access tickets of groups by level', () => {
    const agent: Actor = {
      ...base,
      permissions: new Set(['ticket.agent']),
      groupLevels: new Map([
        ['g1', ['read']],
        ['g2', ['full']],
      ]),
    };
    expect(policy.ticketScope(agent, 'read')).toEqual({ OR: [{ groupId: { in: ['g1', 'g2'] } }] });
    expect(policy.ticketScope(agent, 'change')).toEqual({ OR: [{ groupId: { in: ['g2'] } }] });
    expect(policy.canAccessTicket(agent, ticket())).toBe(true);
    expect(policy.canAccessTicket(agent, ticket(), 'change')).toBe(false);
    expect(policy.canAccessTicket(agent, ticket({ groupId: 'g3' }))).toBe(false);
    expect(policy.isAgentFor(agent, { groupId: 'g1' })).toBe(true);
  });

  it('customers see own tickets; organization tickets only with shared access', () => {
    const customer: Actor = {
      ...base,
      userId: 'c1',
      permissions: new Set(['ticket.customer']),
      organizationIds: ['o1'],
    };
    expect(policy.ticketScope(customer)).toEqual({ OR: [{ customerId: 'c1' }] });
    expect(policy.canAccessTicket(customer, ticket())).toBe(true);
    expect(policy.canAccessTicket(customer, ticket({ customerId: 'c2' }))).toBe(false);

    const shared = { ...customer, sharedOrganization: true, organizationIds: ['o1', 'o9'] };
    expect(policy.ticketScope(shared)).toEqual({
      OR: [{ customerId: 'c1' }, { organizationId: { in: ['o1', 'o9'] } }],
    });
    expect(policy.canAccessTicket(shared, ticket({ customerId: 'c2' }))).toBe(true);
    expect(policy.canAccessTicket(shared, ticket({ customerId: 'c2', organizationId: 'o2' }))).toBe(
      false,
    );
    expect(policy.canAccessTicket(shared, ticket({ customerId: 'c2', organizationId: null }))).toBe(
      false,
    );
    expect(policy.isAgentFor(shared, { groupId: 'g1' })).toBe(false);
    // Customers never get "overview" (agent-only views)
    expect(policy.ticketScope(shared, 'overview')).toEqual({ OR: [{ id: { in: [] } }] });
  });

  it('assertTicket hides existence with 404 and returns 403 for insufficient level', () => {
    const agent: Actor = {
      ...base,
      permissions: new Set(['ticket.agent']),
      groupLevels: new Map([['g1', ['read']]]),
    };
    expect(() => policy.assertTicket(agent, null)).toThrow(/Not Found/);
    expect(() => policy.assertTicket(agent, ticket({ groupId: 'g2' }))).toThrow(/Not Found/);
    expect(() => policy.assertTicket(agent, ticket(), 'change')).toThrow(/Forbidden/);
    expect(() => policy.assertTicket(agent, ticket())).not.toThrow();
  });
});
