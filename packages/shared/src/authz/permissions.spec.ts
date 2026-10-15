import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, hasPermission, levelGrants } from './permissions';

describe('permissions', () => {
  it('parents grant children', () => {
    expect(hasPermission(['admin'], 'admin.user')).toBe(true);
    expect(hasPermission(new Set(['admin.user']), 'admin.user')).toBe(true);
    expect(hasPermission(['admin.user'], 'admin')).toBe(false);
    expect(hasPermission(['admin.user'], 'admin.security')).toBe(false);
    expect(hasPermission(['ticket.customer'], 'ticket.agent')).toBe(false);
  });
  it('admins are not agents by default', () => {
    expect(hasPermission(DEFAULT_ROLES.admin, 'ticket.agent')).toBe(false);
    expect(hasPermission(DEFAULT_ROLES.customer, 'admin')).toBe(false);
  });
  it('group levels', () => {
    expect(levelGrants(['full'], 'change')).toBe(true);
    expect(levelGrants(['read'], 'change')).toBe(false);
    expect(levelGrants(['read', 'change'], 'change')).toBe(true);
  });
});
