import type { HostArea, Role } from '@mesa/shared';
import type { SessionRecord } from '../security/session.service';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string;
  locale: string;
  mfaEnabled: boolean;
}

export interface AuthContext {
  user: AuthenticatedUser;
  session: SessionRecord;
  /** Public session id (hash of the cookie value). */
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Web area served by the Host header, or null for unknown hosts. */
    area: HostArea | null;
    clientIp: string;
    correlationId: string;
    auth?: AuthContext;
  }
}
