import { describe, expect, it } from 'vitest';
import { PolicyService } from './policy.service';
import type { AuthenticatedUser } from '../common/request-context';

const user = (role: AuthenticatedUser['role']): AuthenticatedUser => ({
  id: 'u1',
  email: 'u@x.mx',
  name: 'U',
  role,
  organizationId: 'o1',
  locale: 'es-MX',
  mfaEnabled: true,
});

describe('PolicyService', () => {
  const p = new PolicyService();

  it('scopes users by role', () => {
    expect(p.userScope(user('ADMIN'))).toEqual({});
    expect(p.userScope(user('AGENT'))).toEqual({ role: 'CUSTOMER' });
    expect(p.userScope(user('CUSTOMER'))).toEqual({ id: 'u1' });
  });

  it('scopes organizations by role', () => {
    expect(p.organizationScope(user('AGENT'))).toEqual({ isInternal: false });
    expect(p.organizationScope(user('CUSTOMER'))).toEqual({ id: 'o1' });
  });

  it('only lets customers be invited into customer organizations and staff into internal ones', () => {
    expect(p.canInvite(user('AGENT'), 'CUSTOMER', { isInternal: false })).toBe(true);
    expect(p.canInvite(user('AGENT'), 'CUSTOMER', { isInternal: true })).toBe(false);
    expect(p.canInvite(user('AGENT'), 'AGENT', { isInternal: true })).toBe(false);
    expect(p.canInvite(user('ADMIN'), 'AGENT', { isInternal: true })).toBe(true);
    expect(p.canInvite(user('ADMIN'), 'ADMIN', { isInternal: false })).toBe(false);
    expect(p.canInvite(user('CUSTOMER'), 'CUSTOMER', { isInternal: false })).toBe(false);
  });
});
