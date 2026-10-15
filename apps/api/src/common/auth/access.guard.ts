import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@inn/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { SessionService } from '../../modules/auth/session.service';
import { ActorLoaderService } from './actor-loader.service';
import type { Area } from './actor';
import { areaForHost } from './area';
import { clearCookie, readCookie } from './cookies';
import { CsrfService } from './csrf.service';
import {
  ALLOW_MFA_PENDING,
  ALLOW_MFA_SETUP,
  ANY_HOST,
  AREA,
  AUTHENTICATED,
  IS_PUBLIC,
  PERMISSIONS,
  REAUTH,
  SKIP_CSRF,
} from './decorators';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard (ADR-0002). Order:
 * 1. Host → area; route area restriction (agent/admin endpoints only on the agent host).
 * 2. Policy declaration: routes without @Public or @RequirePermission are denied.
 * 3. Session resolution (cookie of the current host only).
 * 4. CSRF for state-changing requests.
 * 5. Authentication, MFA state, permission, re-authentication.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly actors: ActorLoaderService,
    private readonly csrf: CsrfService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const reply = ctx.switchToHttp().getResponse<FastifyReply>();

    const isPublic = this.meta<boolean>(IS_PUBLIC, ctx) === true;
    const permissions = this.meta<string[]>(PERMISSIONS, ctx);
    if (!isPublic && (!permissions || permissions.length === 0)) {
      // Deny by default: an endpoint that forgot to declare its policy is unreachable.
      throw new ForbiddenException();
    }

    // 1. Host / area
    const area = areaForHost(this.config, req.headers.host);
    req.area = area;
    if (
      !area &&
      isPublic &&
      this.meta<boolean>(ANY_HOST, ctx) === true &&
      SAFE_METHODS.has(req.method)
    )
      return true;
    const declared = this.meta<Area | 'any'>(AREA, ctx);
    const required: Area | 'any' =
      declared ??
      (permissions?.some((p) => p.startsWith('admin') || p === 'ticket.agent') ? 'agent' : 'any');
    if (!area) throw new NotFoundException();
    if (required !== 'any' && required !== area) throw new NotFoundException();

    // 3. Session
    const sid = readCookie(req, this.config, 'sid', area);
    if (sid) {
      const info = await this.sessions.load(sid);
      if (info && info.area === area) {
        req.session = info;
      } else if (!info) {
        clearCookie(reply, this.config, 'sid', area);
      }
    }

    // 4. CSRF
    if (!SAFE_METHODS.has(req.method) && this.meta<boolean>(SKIP_CSRF, ctx) !== true) {
      const binding = req.session?.hash ?? 'anon';
      const ok = this.csrf.verify(
        readCookie(req, this.config, 'csrf', area),
        req.headers['x-csrf-token'] as string | undefined,
        binding,
      );
      if (!ok) throw new ForbiddenException('csrf_invalid');
    }

    if (isPublic) return true;

    // 5. Authentication and MFA state
    const session = req.session;
    if (!session) throw new UnauthorizedException();
    if (session.mfaPending && this.meta<boolean>(ALLOW_MFA_PENDING, ctx) !== true) {
      throw new UnauthorizedException('mfa_required');
    }
    if (
      !session.mfaPending &&
      session.mfaSetupRequired &&
      this.meta<boolean>(ALLOW_MFA_SETUP, ctx) !== true
    ) {
      throw new ForbiddenException('mfa_setup_required');
    }

    const actor = await this.actors.load(session.userId);
    if (!actor) {
      await this.sessions.destroyByHash(session.hash, session.userId);
      clearCookie(reply, this.config, 'sid', area);
      throw new UnauthorizedException();
    }
    req.actor = actor;

    if (!permissions!.some((p) => p === AUTHENTICATED || hasPermission(actor.permissions, p))) {
      throw new ForbiddenException();
    }

    if (this.meta<boolean>(REAUTH, ctx) === true) {
      const maxAge = this.config.REAUTH_MAX_AGE_MINUTES * 60_000;
      if (!session.reauthAt || Date.now() - session.reauthAt > maxAge) {
        throw new HttpException(
          { statusCode: 401, message: 'reauth_required' },
          HttpStatus.UNAUTHORIZED,
        );
      }
    }
    return true;
  }
}
