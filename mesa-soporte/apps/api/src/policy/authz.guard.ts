import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  areaForRole,
  effectivePermissions,
  type AuthState,
  type HostArea,
  type Permission,
} from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../security/session.service';
import { safeEqual } from '../security/tokens';
import {
  ANY_PERMISSIONS_KEY,
  AREA_KEY,
  PERMISSIONS_KEY,
  PUBLIC_KEY,
  REAUTH_KEY,
  STATES_KEY,
} from './decorators';
import { SESSION_COOKIE } from './session-cookie';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard. Deny by default: a handler without @Public() or
 * @RequirePermissions() is rejected, so a forgotten decorator fails closed.
 */
@Injectable()
export class AuthzGuard implements CanActivate {
  private readonly logger = new Logger(AuthzGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const isPublic = this.meta<boolean>(PUBLIC_KEY, ctx) === true;
    const permissions = this.meta<Permission[]>(PERMISSIONS_KEY, ctx);
    const anyOf = this.meta<Permission[]>(ANY_PERMISSIONS_KEY, ctx);
    const area = this.meta<HostArea | 'any'>(AREA_KEY, ctx);

    if (!isPublic && !permissions && !anyOf) {
      this.logger.error(
        `Route without authorization metadata: ${req.method} ${req.routeOptions.url}`,
      );
      throw new AppError('forbidden');
    }
    if (area && area !== 'any' && req.area !== area) throw new AppError('wrong_host');

    const token = req.cookies?.[SESSION_COOKIE];
    const resolved = await this.sessions.resolve(token);

    if (isPublic) {
      // Public routes may still use the session when present (e.g. logout).
      if (resolved) await this.attach(req, resolved, false);
      return true;
    }

    if (!resolved) throw new AppError('unauthenticated');
    await this.attach(req, resolved, true);
    const auth = req.auth!;

    const allowed: AuthState[] = [
      'authenticated',
      ...(this.meta<AuthState[]>(STATES_KEY, ctx) ?? []),
    ];
    if (!allowed.includes(auth.session.state)) {
      throw new AppError(
        auth.session.state === 'mfa_enrollment_required'
          ? 'mfa_enrollment_required'
          : 'mfa_required',
        undefined,
        undefined,
        403,
      );
    }

    if (!SAFE_METHODS.has(req.method)) {
      const header = req.headers['x-csrf-token'];
      if (typeof header !== 'string' || !safeEqual(header, auth.session.csrfToken)) {
        throw new AppError('csrf_failed');
      }
    }

    for (const p of permissions ?? []) {
      if (!auth.user.permissions.includes(p)) throw new AppError('forbidden');
    }
    if (anyOf && !anyOf.some((p) => auth.user.permissions.includes(p))) {
      throw new AppError('forbidden');
    }

    if (this.meta<boolean>(REAUTH_KEY, ctx)) {
      const windowMs = this.config.REAUTH_WINDOW_MINUTES * 60_000;
      if (!auth.session.reauthAt || Date.now() - auth.session.reauthAt > windowMs) {
        throw new AppError('reauthentication_required');
      }
    }
    return true;
  }

  private async attach(
    req: FastifyRequest,
    resolved: { id: string; record: import('../security/session.service').SessionRecord },
    strict: boolean,
  ): Promise<void> {
    const { id, record } = resolved;
    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
      include: { customRoles: { where: { role: { active: true } }, select: { role: true } } },
    });
    const valid =
      user &&
      user.status === 'ACTIVE' &&
      record.area === req.area &&
      areaForRole(user.role) === req.area;
    if (!valid) {
      if (user && user.status !== 'ACTIVE') await this.sessions.destroy(id, record.userId);
      if (strict) throw new AppError('unauthenticated');
      return;
    }
    req.auth = {
      sessionId: id,
      session: record,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        locale: user.locale,
        mfaEnabled: user.totpEnabledAt !== null,
        permissions: effectivePermissions(
          user.role,
          user.customRoles.flatMap((c) => c.role.permissions),
        ),
      },
    };
  }
}
