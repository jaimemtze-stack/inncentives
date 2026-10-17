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
  ],
  CUSTOMER: [Permission.SelfManage],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return RolePermissions[role].includes(permission);
}

/** The two web areas. Each one is served on its own host. */
export type HostArea = 'portal' | 'agent';

export function areaForRole(role: Role): HostArea {
  return role === 'CUSTOMER' ? 'portal' : 'agent';
}
