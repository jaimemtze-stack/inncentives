import { describe, expect, it } from 'vitest';
import {
  InvitationCreateSchema,
  LoginSchema,
  MfaVerifySchema,
  OrganizationCreateSchema,
  PasswordSchema,
} from './schemas';
import { effectivePermissions, roleHasPermission, Permission, areaForRole } from './permissions';

describe('schemas', () => {
  it('normalises the login email', () => {
    expect(LoginSchema.parse({ email: '  Ana@Example.COM ', password: 'x' }).email).toBe(
      'ana@example.com',
    );
  });

  it('enforces password length without composition rules', () => {
    expect(PasswordSchema.safeParse('short').success).toBe(false);
    expect(PasswordSchema.safeParse('correct horse battery').success).toBe(true);
    expect(PasswordSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });

  it('accepts either a TOTP code or a recovery code, not both', () => {
    expect(MfaVerifySchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(MfaVerifySchema.safeParse({ recoveryCode: 'abcde-12345' }).success).toBe(true);
    expect(MfaVerifySchema.safeParse({ code: '123456', recoveryCode: 'abcde-12345' }).success).toBe(
      false,
    );
    expect(MfaVerifySchema.safeParse({ code: '12345a' }).success).toBe(false);
  });

  it('rejects unknown properties (mass assignment)', () => {
    const r = InvitationCreateSchema.safeParse({
      email: 'a@b.mx',
      name: 'A',
      role: 'CUSTOMER',
      organizationId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      isAdmin: true,
    });
    expect(r.success).toBe(false);
  });

  it('validates organization domains', () => {
    expect(
      OrganizationCreateSchema.safeParse({ name: 'ACME', domains: ['acme.com.mx'] }).success,
    ).toBe(true);
    expect(
      OrganizationCreateSchema.safeParse({ name: 'ACME', domains: ['not a domain'] }).success,
    ).toBe(false);
  });
});

describe('permissions', () => {
  it('gives customers only self-management and their tickets', () => {
    expect(roleHasPermission('CUSTOMER', Permission.SelfManage)).toBe(true);
    expect(roleHasPermission('CUSTOMER', Permission.TicketsCustomer)).toBe(true);
    expect(roleHasPermission('CUSTOMER', Permission.UsersRead)).toBe(false);
  });

  it('extends staff with custom roles but never customers', () => {
    expect(effectivePermissions('AGENT', [Permission.AdminConfig, 'bogus'])).toContain(
      Permission.AdminConfig,
    );
    expect(effectivePermissions('AGENT', ['bogus'])).not.toContain('bogus');
    expect(effectivePermissions('AGENT', [Permission.TicketsCustomer])).not.toContain(
      Permission.TicketsCustomer,
    );
    expect(effectivePermissions('CUSTOMER', [Permission.AdminConfig])).toEqual(
      [Permission.SelfManage, Permission.TicketsCustomer].sort(),
    );
  });

  it('does not let agents invite staff or read the audit log', () => {
    expect(roleHasPermission('AGENT', Permission.UsersInviteCustomer)).toBe(true);
    expect(roleHasPermission('AGENT', Permission.UsersInviteStaff)).toBe(false);
    expect(roleHasPermission('AGENT', Permission.AuditRead)).toBe(false);
  });

  it('maps roles to host areas', () => {
    expect(areaForRole('CUSTOMER')).toBe('portal');
    expect(areaForRole('AGENT')).toBe('agent');
    expect(areaForRole('ADMIN')).toBe('agent');
  });
});
