/**
 * Permission names (Zammad-style, dotted). A permission grants all of its children:
 * holding "admin" grants "admin.user", etc.
 */
export const PERMISSIONS = [
  'admin',
  'admin.user',
  'admin.organization',
  'admin.group',
  'admin.role',
  'admin.security',
  'admin.audit',
  'admin.sla',
  'admin.calendar',
  'admin.automation',
  'admin.object',
  'admin.channel',
  'admin.integration',
  'admin.api_token',
  'admin.data_privacy',
  'admin.view_as_customer',
  'ticket.agent',
  'ticket.customer',
  'user_preferences',
  'user_preferences.password',
  'user_preferences.mfa',
  'user_preferences.sessions',
  'user_preferences.notifications',
  'report',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const DEFAULT_ROLES: Record<'admin' | 'agent' | 'customer', Permission[]> = {
  admin: ['admin', 'user_preferences', 'report'],
  agent: ['ticket.agent', 'user_preferences', 'report'],
  customer: ['ticket.customer', 'user_preferences'],
};

/** True if `granted` contains `required` or one of its ancestors. */
export function hasPermission(granted: Iterable<string>, required: string): boolean {
  const set = granted instanceof Set ? (granted as Set<string>) : new Set(granted);
  const parts = required.split('.');
  for (let i = parts.length; i > 0; i--) {
    if (set.has(parts.slice(0, i).join('.'))) return true;
  }
  return false;
}

/** Group access levels for agents, from least to most privileged. */
export const GROUP_ACCESS_LEVELS = ['read', 'create', 'change', 'overview', 'full'] as const;
export type GroupAccessLevel = (typeof GROUP_ACCESS_LEVELS)[number];

/**
 * Zammad semantics: each level is independent, `full` implies all.
 * read: view tickets · create: create tickets · change: modify · overview: see in overviews.
 */
export function levelGrants(
  held: readonly GroupAccessLevel[],
  required: GroupAccessLevel,
): boolean {
  return held.includes('full') || held.includes(required);
}
