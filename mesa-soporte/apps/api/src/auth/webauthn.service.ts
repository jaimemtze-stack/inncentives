import { Inject, Injectable } from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AppError } from '../common/errors';
import type { AuthContext } from '../common/request-context';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { RateLimitService } from '../security/rate-limit.service';
import { SessionService, type CreatedSession } from '../security/session.service';
import { newRecoveryCode, sha256Hex } from '../security/tokens';
import { AuthService } from './auth.service';

const CHALLENGE_TTL = 300;
const RECOVERY_CODE_COUNT = 10;

/**
 * Passkeys / security keys as a second factor (phase 2). Credentials are
 * bound to the host of the area (portal or agents) through the RP ID and the
 * expected origin; challenges live 5 minutes in Redis, tied to the session.
 */
@Injectable()
export class WebAuthnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly limits: RateLimitService,
    private readonly auth: AuthService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private rp(req: FastifyRequest) {
    const host = req.headers.host ?? '';
    return { rpID: host.split(':')[0]!, origin: `${this.config.PUBLIC_SCHEME}://${host}` };
  }

  async registrationOptions(req: FastifyRequest, ctx: AuthContext) {
    const existing = await this.prisma.webAuthnCredential.findMany({
      where: { userId: ctx.user.id },
    });
    if (existing.length >= 10) throw new AppError('conflict', 'Too many security keys.');
    const options = await generateRegistrationOptions({
      rpName: this.config.APP_NAME,
      rpID: this.rp(req).rpID,
      userName: ctx.user.email,
      userDisplayName: ctx.user.name,
      userID: new TextEncoder().encode(ctx.user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports as never,
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    await this.redis.set(`webauthn:reg:${ctx.sessionId}`, options.challenge, 'EX', CHALLENGE_TTL);
    return options;
  }

  async register(
    req: FastifyRequest,
    ctx: AuthContext,
    response: RegistrationResponseJSON,
    name: string,
  ): Promise<{ recoveryCodes?: string[]; session?: CreatedSession }> {
    const challenge = await this.redis.getdel(`webauthn:reg:${ctx.sessionId}`);
    if (!challenge) throw new AppError('bad_request', 'Start the registration again.');
    const { rpID, origin } = this.rp(req);
    const v = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    }).catch(() => ({ verified: false, registrationInfo: undefined }));
    if (!v.verified || !v.registrationInfo)
      throw new AppError('mfa_invalid', 'The security key could not be verified.');
    const cred = v.registrationInfo.credential;
    const hadMfa = (await this.auth.mfaMethods(ctx.user.id)).length > 0;
    const recoveryCodes = hadMfa
      ? undefined
      : Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.prisma.$transaction(async (tx) => {
      await tx.webAuthnCredential.create({
        data: {
          userId: ctx.user.id,
          credentialId: cred.id,
          publicKey: Buffer.from(cred.publicKey),
          counter: BigInt(cred.counter),
          transports: cred.transports ?? [],
          name,
        },
      });
      if (recoveryCodes) {
        await tx.recoveryCode.deleteMany({ where: { userId: ctx.user.id } });
        await tx.recoveryCode.createMany({
          data: recoveryCodes.map((c) => ({ userId: ctx.user.id, codeHash: sha256Hex(c) })),
        });
      }
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'auth.webauthn.registered',
          organizationId: ctx.user.organizationId,
          data: { name },
        },
        tx,
      );
    });
    await this.mail.send({
      template: 'mfa_enabled',
      to: ctx.user.email,
      locale: ctx.user.locale,
      params: { name: ctx.user.name },
    });
    if (ctx.session.state === 'mfa_enrollment_required') {
      const session = await this.sessions.rotate(ctx.sessionId, ctx.session, {
        state: 'authenticated',
      });
      await this.auth.onFullyAuthenticated(
        req,
        await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } }),
      );
      return { recoveryCodes, session };
    }
    return { recoveryCodes };
  }

  async authenticationOptions(req: FastifyRequest, ctx: AuthContext) {
    const creds = await this.prisma.webAuthnCredential.findMany({ where: { userId: ctx.user.id } });
    if (!creds.length) throw new AppError('bad_request', 'No security key registered.');
    const options = await generateAuthenticationOptions({
      rpID: this.rp(req).rpID,
      allowCredentials: creds.map((c) => ({
        id: c.credentialId,
        transports: c.transports as never,
      })),
      userVerification: 'preferred',
    });
    await this.redis.set(`webauthn:auth:${ctx.sessionId}`, options.challenge, 'EX', CHALLENGE_TTL);
    return options;
  }

  /** Second factor at sign-in: the session moves from mfa_required to authenticated. */
  async authenticate(
    req: FastifyRequest,
    ctx: AuthContext,
    response: AuthenticationResponseJSON,
  ): Promise<CreatedSession> {
    if (ctx.session.state !== 'mfa_required')
      throw new AppError('bad_request', 'MFA is not pending.');
    await this.limits.assertNotBlocked('mfa', ctx.user.id);
    const challenge = await this.redis.getdel(`webauthn:auth:${ctx.sessionId}`);
    const cred = await this.prisma.webAuthnCredential.findFirst({
      where: { userId: ctx.user.id, credentialId: response.id },
    });
    let ok = false;
    if (challenge && cred) {
      const { rpID, origin } = this.rp(req);
      const v = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: cred.credentialId,
          publicKey: new Uint8Array(cred.publicKey),
          counter: Number(cred.counter),
          transports: cred.transports as never,
        },
        requireUserVerification: false,
      }).catch(() => ({ verified: false, authenticationInfo: undefined }));
      if (v.verified && v.authenticationInfo) {
        ok = true;
        await this.prisma.webAuthnCredential.update({
          where: { id: cred.id },
          data: { counter: BigInt(v.authenticationInfo.newCounter), lastUsedAt: new Date() },
        });
      }
    }
    if (!ok) {
      await this.limits.penalize('mfa', ctx.user.id);
      await this.audit.record({
        ...AuditService.fromRequest(req),
        action: 'auth.mfa.failed',
        organizationId: ctx.user.organizationId,
        data: { method: 'webauthn' },
      });
      throw new AppError('mfa_invalid', 'The security key could not be verified.');
    }
    await this.limits.reset('mfa', ctx.user.id);
    const session = await this.sessions.rotate(ctx.sessionId, ctx.session, {
      state: 'authenticated',
      reauthAt: Date.now(),
    });
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'auth.mfa.succeeded',
      organizationId: ctx.user.organizationId,
      data: { method: 'webauthn' },
    });
    await this.auth.onFullyAuthenticated(
      req,
      await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } }),
    );
    return session;
  }

  async list(ctx: AuthContext) {
    const rows = await this.prisma.webAuthnCredential.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
    }));
  }

  /** Removing the last factor of someone who must use MFA is refused. */
  async remove(req: FastifyRequest, ctx: AuthContext, id: string) {
    const cred = await this.prisma.webAuthnCredential.findFirst({
      where: { id, userId: ctx.user.id },
    });
    if (!cred) throw new AppError('not_found');
    const methods = await this.auth.mfaMethods(ctx.user.id);
    const remaining = await this.prisma.webAuthnCredential.count({
      where: { userId: ctx.user.id },
    });
    if (!methods.includes('totp') && remaining <= 1 && ctx.user.role !== 'CUSTOMER') {
      throw new AppError('conflict', 'Staff accounts must keep at least one second factor.');
    }
    await this.prisma.webAuthnCredential.delete({ where: { id } });
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'auth.webauthn.removed',
      organizationId: ctx.user.organizationId,
      data: { name: cred.name },
    });
    await this.mail.send({
      template: 'mfa_disabled',
      to: ctx.user.email,
      locale: ctx.user.locale,
      params: { name: ctx.user.name },
    });
  }
}
