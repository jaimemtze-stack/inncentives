/**
 * Permission catalogue. The API denies by default: every route must declare
 * either @Public() or the permissions it requires.
 */
export const Permission = {
  /** Manage own profile, password, MFA and sessions. */
  SelfManage: 'self.manage',
  OrganizationsRead: 'admin.organizations.read',
  OrganizationsWrite: 'admin.organizations.write',
  UsersRead: 'admin.users.read',
  UsersInviteCustomer: 'admin.users.invite_customer',
  UsersInviteStaff: 'admin.users.invite_staff',
  UsersManageSessions: 'admin.users.manage_sessions',
  AuditRead: 'admin.audit.read',
  /** Work tickets in the agents area (scoped further by group access). */
  TicketsAgent: 'tickets.agent',
  /** Own (or organization) tickets in the customer portal. */
  TicketsCustomer: 'tickets.customer',
  /** Groups, SLAs, calendars, triggers, macros, channels and other settings. */
  AdminConfig: 'admin.config',
  /** Data subject requests: export, anonymise, delete; retention policies. */
  DataPrivacy: 'admin.data_privacy',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const Roles = ['ADMIN', 'AGENT', 'CUSTOMER'] as const;
export type Role = (typeof Roles)[number];

export const StaffRoles: readonly Role[] = ['ADMIN', 'AGENT'];

export const RolePermissions: Record<Role, readonly Permission[]> = {
  ADMIN: Object.values(Permission),
  AGENT: [
    Permission.SelfManage,
    Permission.OrganizationsRead,
    Permission.UsersRead,
    Permission.UsersInviteCustomer,
    Permission.TicketsAgent,
  ],
  CUSTOMER: [Permission.SelfManage, Permission.TicketsCustomer],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return RolePermissions[role].includes(permission);
}

const ALL_PERMISSIONS = new Set<string>(Object.values(Permission));

export function isPermission(value: string): value is Permission {
  return ALL_PERMISSIONS.has(value);
}

/**
 * Base role permissions plus those granted by custom roles. Custom roles only
 * extend staff accounts: a customer never gains agent or admin permissions.
 */
export function effectivePermissions(role: Role, granted: readonly string[] = []): Permission[] {
  const out = new Set<Permission>(RolePermissions[role]);
  if (role !== 'CUSTOMER') {
    for (const p of granted) {
      if (isPermission(p) && p !== Permission.TicketsCustomer) out.add(p);
    }
  }
  return [...out].sort();
}

/** The two web areas. Each one is served on its own host. */
export type HostArea = 'portal' | 'agent';

export function areaForRole(role: Role): HostArea {
  return role === 'CUSTOMER' ? 'portal' : 'agent';
}
