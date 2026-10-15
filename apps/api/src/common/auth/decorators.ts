import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Permission } from '@inn/shared';
import type { Actor, Area } from './actor';

export const IS_PUBLIC = 'inn:isPublic';
export const PERMISSIONS = 'inn:permissions';
export const AREA = 'inn:area';
export const REAUTH = 'inn:reauth';
export const ALLOW_MFA_PENDING = 'inn:allowMfaPending';
export const ALLOW_MFA_SETUP = 'inn:allowMfaSetup';
export const SKIP_CSRF = 'inn:skipCsrf';
export const ANY_HOST = 'inn:anyHost';

/** Route reachable without a session. Must still be explicit. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Pseudo-permission satisfied by any authenticated, active user. */
export const AUTHENTICATED = 'authenticated';

/** Route requires any authenticated user (own profile, own sessions…). */
export const Authenticated = () => SetMetadata(PERMISSIONS, [AUTHENTICATED]);

/** Route requires ANY of the given permissions. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS, permissions);

/** Restricts the route to a host. Defaults: admin.* / ticket.agent → agent; everything else → any. */
export const AreaOnly = (area: Area | 'any') => SetMetadata(AREA, area);

/** Requires a recent re-authentication (ASVS V3.7.1). */
export const RequireReauth = () => SetMetadata(REAUTH, true);

/** Accepts sessions waiting for the second factor. */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING, true);

/** Accepts sessions that must enroll MFA before doing anything else. */
export const AllowMfaSetup = () => SetMetadata(ALLOW_MFA_SETUP, true);

/** Machine-to-machine endpoints authenticated by HMAC (/hooks/*). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!req.actor) throw new Error('CurrentActor used on a route without an authenticated actor');
  return req.actor;
});

/** Probes reachable on any Host header (internal health checks). Only valid with @Public. */
export const AnyHost = () => SetMetadata(ANY_HOST, true);
