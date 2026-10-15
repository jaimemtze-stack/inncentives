import type { GroupAccessLevel } from '@inn/shared';

export type Area = 'portal' | 'agent';

/** The authenticated principal for a request, resolved once by the AccessGuard. */
export interface Actor {
  userId: string;
  email: string;
  roles: string[];
  permissions: Set<string>;
  /** Primary + secondary organizations. */
  organizationIds: string[];
  /** Customer can see all tickets of their organizations. */
  sharedOrganization: boolean;
  /** Agent group access: groupId → levels. */
  groupLevels: Map<string, GroupAccessLevel[]>;
  locale: string;
}

export interface SessionInfo {
  /** SHA-256 of the session id (Redis key suffix). */
  hash: string;
  userId: string;
  area: Area;
  createdAt: number;
  lastSeenAt: number;
  mfaPending: boolean;
  mfaSetupRequired: boolean;
  reauthAt: number | null;
  ip: string | null;
  userAgent: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
    session?: SessionInfo;
    area?: Area | null;
    correlationId: string;
    clientIp: string;
  }
}
