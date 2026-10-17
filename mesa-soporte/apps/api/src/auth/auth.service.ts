import { Inject, Injectable } from '@nestjs/common';
import {
  areaForRole,
  type AuthState,
  type HostArea,
  type MeResponse,
  type SessionInfo,
} from '@mesa/shared';
import type { User } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AppError } from '../common/errors';
import type { AuthContext } from '../common/request-context';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { FieldEncryption } from '../security/field-encryption';
import { PasswordService } from '../security/password.service';
import { RateLimitService } from '../security/rate-limit.service';
import { SessionService, type CreatedSession } from '../security/session.service';
import { TotpService } from '../security/totp.service';
import { newRecoveryCode, newToken, sha256Hex } from '../security/tokens';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module';

const MAX_MFA_FAILURES_PER_SESSION = 5;
const RECOVERY_CODE_COUNT = 10;

function userAgentOf(req: FastifyRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 400) : null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly limits: RateLimitService,
    private readonly totp: TotpService,
    private readonly fields: FieldEncryption,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private requireArea(req: FastifyRequest): HostArea {
    if (!req.area) throw new AppError('wrong_host');
    return req.area;
  }

  private totpAad(userId: string): string {
    return `user:${userId}:totp`;
  }

  private async mfaRequired(user: User): Promise<boolean> {
    if (user.role !== 'CUSTOMER') return true;
    const org = await this.prisma.organization.findUnique({ where: { id: user.organizationId } });
    return org?.mfaRequiredForCustomers ?? false;
  }

  // ---------------------------------------------------------------- login

  async login(req: FastifyRequest, email: string, password: string): Promise<CreatedSession> {
    const area = this.requireArea(req);
    const accountKey = RateLimitService.accountKey(email);
    await this.limits.consume('loginIp', req.clientIp);
    await this.limits.assertNotBlocked('loginAccount', accountKey);
    await this.limits.assertNotBlocked('loginAccountDaily', accountKey);

    const user = await this.prisma.user.findUnique({ where: { email } });
    const passwordOk = user
      ? await this.passwords.verify(user.passwordHash, password)
      : (await this.passwords.verifyDummy(password), false);

    let reason: string | null = null;
    if (!user) reason = 'unknown_email';
    else if (!passwordOk) reason = 'bad_password';
    else if (user.status !== 'ACTIVE') reason = `status_${user.status.toLowerCase()}`;
    else if (areaForRole(user.role) !== area) reason = 'wrong_area';

    if (reason || !user) {
      await this.limits.penalize('loginAccount', accountKey);
      await this.limits.penalize('loginAccountDaily', accountKey);
      await this.audit.record({
        ...AuditService.fromRequest(req),
        action: 'auth.login.failed',
        targetType: 'user',
        targetId: user?.id ?? null,
        organizationId: user?.organizationId ?? null,
        data: { reason, area, emailHash: accountKey },
      });
      // Same answer for every failure: no account enumeration.
      throw new AppError('invalid_credentials');
    }

    await this.limits.reset('loginAccount', accountKey);
    let state: AuthState = 'authenticated';
    if (user.totpEnabledAt) state = 'mfa_required';
    else if (await this.mfaRequired(user)) state = 'mfa_enrollment_required';

    const created = await this.sessions.create({
      userId: user.id,
      area,
      state,
      ip: req.clientIp,
      userAgent: userAgentOf(req),
      reauthAt: Date.now(),
    });
    await this.audit.record({
      ...AuditService.fromRequest(req),
      actorType: 'user',
      actorUserId: user.id,
      action: state === 'authenticated' ? 'auth.login.succeeded' : 'auth.login.password_ok',
      organizationId: user.organizationId,
      data: { area, next: state },
    });
    if (state === 'authenticated') await this.onFullyAuthenticated(req, user);
    return created;
  }

  /** Bookkeeping once a session reaches the authenticated state. */
  private async onFullyAuthenticated(req: FastifyRequest, user: User): Promise<void> {
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const ua = userAgentOf(req) ?? 'unknown';
    const fingerprintHash = sha256Hex(`${user.id}|${ua}`);
    const known = await this.prisma.userDevice.findUnique({
      where: { userId_fingerprintHash: { userId: user.id, fingerprintHash } },
    });
    if (known) {
      await this.prisma.userDevice.update({
        where: { id: known.id },
        data: { lastSeenAt: new Date() },
      });
      return;
    }
    const isFirstDevice =
      (await this.prisma.userDevice.count({ where: { userId: user.id } })) === 0;
    await this.prisma.userDevice.create({ data: { userId: user.id, fingerprintHash } });
    if (!isFirstDevice) {
      await this.mail.send({
        template: 'new_device_login',
        to: user.email,
        locale: user.locale,
        params: {
          name: user.name,
          ip: req.clientIp,
          userAgent: ua,
          when: new Date().toISOString(),
        },
      });
    }
  }

  // ------------------------------------------------------------------ MFA

  async verifyMfa(
    req: FastifyRequest,
    auth: AuthContext,
    input: { code?: string; recoveryCode?: string },
  ): Promise<CreatedSession> {
    const { user, session, sessionId } = auth;
    if (session.state !== 'mfa_required') throw new AppError('bad_request', 'MFA is not pending.');
    await this.limits.assertNotBlocked('mfa', user.id);
    const dbUser = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    let ok = false;
    let method = 'totp';
    if (input.code && dbUser.totpSecretEnc) {
      const secret = this.fields.decrypt(dbUser.totpSecretEnc, this.totpAad(user.id));
      ok = await this.totp.verifyOnce(user.id, secret, input.code);
    } else if (input.recoveryCode) {
      method = 'recovery_code';
      const used = await this.prisma.recoveryCode.updateMany({
        where: { userId: user.id, codeHash: sha256Hex(input.recoveryCode), usedAt: null },
        data: { usedAt: new Date() },
      });
      ok = used.count === 1;
    }

    if (!ok) {
      await this.limits.penalize('mfa', user.id);
      session.mfaFailures += 1;
      await this.audit.record({
        ...AuditService.fromRequest(req),
        action: 'auth.mfa.failed',
        organizationId: user.organizationId,
        data: { method, failures: session.mfaFailures },
      });
      if (session.mfaFailures >= MAX_MFA_FAILURES_PER_SESSION) {
        await this.sessions.destroy(sessionId, user.id);
        throw new AppError('unauthenticated', 'Too many failed codes. Sign in again.');
      }
      await this.sessions.update(sessionId, session);
      throw new AppError('mfa_invalid', 'Invalid code.');
    }

    await this.limits.reset('mfa', user.id);
    const rotated = await this.sessions.rotate(sessionId, session, {
      state: 'authenticated',
      reauthAt: Date.now(),
    });
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'auth.mfa.succeeded',
      organizationId: user.organizationId,
      data: { method },
    });
    await this.onFullyAuthenticated(req, dbUser);
    return rotated;
  }

  async startTotpEnrollment(auth: AuthContext): Promise<{ secret: string; otpauthUri: string }> {
    const secret = this.totp.generateSecret();
    // Pending secret lives encrypted in Redis until the user proves possession.
    await this.redis.set(
      `totp_pending:${auth.user.id}`,
      this.fields.encrypt(secret, `pending:${auth.user.id}`),
      'EX',
      600,
    );
    return { secret, otpauthUri: this.totp.keyUri(auth.user.email, this.config.APP_NAME, secret) };
  }

  async confirmTotpEnrollment(
    req: FastifyRequest,
    auth: AuthContext,
    code: string,
  ): Promise<{ recoveryCodes: string[]; session?: CreatedSession }> {
    const { user, session, sessionId } = auth;
    await this.limits.assertNotBlocked('mfa', user.id);
    const pending = await this.redis.get(`totp_pending:${user.id}`);
    if (!pending) throw new AppError('bad_request', 'Start the enrollment again.');
    const secret = this.fields.decrypt(pending, `pending:${user.id}`);
    if (!(await this.totp.verifyOnce(user.id, secret, code))) {
      await this.limits.penalize('mfa', user.id);
      throw new AppError('mfa_invalid', 'Invalid code.');
    }
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          totpSecretEnc: this.fields.encrypt(secret, this.totpAad(user.id)),
          totpEnabledAt: new Date(),
        },
      });
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.recoveryCode.createMany({
        data: recoveryCodes.map((c) => ({ userId: user.id, codeHash: sha256Hex(c) })),
      });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'auth.mfa.enabled',
          organizationId: user.organizationId,
        },
        tx,
      );
    });
    await this.redis.del(`totp_pending:${user.id}`);
    await this.mail.send({
      template: 'mfa_enabled',
      to: user.email,
      locale: user.locale,
      params: { name: user.name },
    });

    if (session.state === 'mfa_enrollment_required') {
      const rotated = await this.sessions.rotate(sessionId, session, { state: 'authenticated' });
      const dbUser = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      await this.onFullyAuthenticated(req, dbUser);
      return { recoveryCodes, session: rotated };
    }
    return { recoveryCodes };
  }

  async disableTotp(req: FastifyRequest, auth: AuthContext): Promise<void> {
    const dbUser = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (await this.mfaRequired(dbUser))
      throw new AppError('forbidden', 'MFA is mandatory for this account.');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: dbUser.id },
        data: { totpSecretEnc: null, totpEnabledAt: null },
      });
      await tx.recoveryCode.deleteMany({ where: { userId: dbUser.id } });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'auth.mfa.disabled',
          organizationId: dbUser.organizationId,
        },
        tx,
      );
    });
    await this.mail.send({
      template: 'mfa_disabled',
      to: dbUser.email,
      locale: dbUser.locale,
      params: { name: dbUser.name },
    });
  }

  async regenerateRecoveryCodes(req: FastifyRequest, auth: AuthContext): Promise<string[]> {
    if (!auth.user.mfaEnabled) throw new AppError('bad_request', 'MFA is not enabled.');
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.prisma.$transaction(async (tx) => {
      await tx.recoveryCode.deleteMany({ where: { userId: auth.user.id } });
      await tx.recoveryCode.createMany({
        data: codes.map((c) => ({ userId: auth.user.id, codeHash: sha256Hex(c) })),
      });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'auth.mfa.recovery_codes_regenerated',
          organizationId: auth.user.organizationId,
        },
        tx,
      );
    });
    return codes;
  }

  // -------------------------------------------------------- re-auth / me

  async reauthenticate(req: FastifyRequest, auth: AuthContext, password: string): Promise<void> {
    await this.limits.assertNotBlocked('reauth', auth.user.id);
    const dbUser = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await this.passwords.verify(dbUser.passwordHash, password))) {
      await this.limits.penalize('reauth', auth.user.id);
      await this.audit.record({ ...AuditService.fromRequest(req), action: 'auth.reauth.failed' });
      throw new AppError('invalid_credentials', 'Invalid password.');
    }
    await this.limits.reset('reauth', auth.user.id);
    auth.session.reauthAt = Date.now();
    await this.sessions.update(auth.sessionId, auth.session);
  }

  me(auth: AuthContext): MeResponse {
    return {
      state: auth.session.state,
      area: auth.session.area,
      user: {
        id: auth.user.id,
        email: auth.user.email,
        name: auth.user.name,
        role: auth.user.role,
        organizationId: auth.user.organizationId,
        locale: auth.user.locale,
        mfaEnabled: auth.user.mfaEnabled,
      },
      permissions: [...auth.user.permissions],
    };
  }

  async logout(req: FastifyRequest): Promise<void> {
    if (!req.auth) return;
    await this.sessions.destroy(req.auth.sessionId, req.auth.user.id);
    await this.audit.record({ ...AuditService.fromRequest(req), action: 'auth.logout' });
  }

  // ------------------------------------------------------------ sessions

  async listSessions(auth: AuthContext): Promise<SessionInfo[]> {
    const list = await this.sessions.list(auth.user.id);
    return list.map(({ id, record }) => ({
      id,
      current: id === auth.sessionId,
      createdAt: new Date(record.createdAt).toISOString(),
      lastSeenAt: new Date(record.lastSeenAt).toISOString(),
      ip: record.ip,
      userAgent: record.userAgent,
    }));
  }

  async revokeSession(req: FastifyRequest, auth: AuthContext, id: string): Promise<void> {
    // Ownership is checked inside destroyOwned; another user's id looks like "not found".
    if (!(await this.sessions.destroyOwned(auth.user.id, id))) throw new AppError('not_found');
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'auth.session.revoked',
      targetType: 'session',
      targetId: id.slice(0, 16),
    });
  }

  async revokeOtherSessions(req: FastifyRequest, auth: AuthContext): Promise<number> {
    const n = await this.sessions.destroyAll(auth.user.id, auth.sessionId);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'auth.session.revoked_others',
      data: { count: n },
    });
    return n;
  }

  // ------------------------------------------------------------ password

  private async assertPasswordAcceptable(password: string): Promise<void> {
    if (await this.passwords.isBreached(password)) {
      throw new AppError(
        'password_breached',
        'This password appears in known data breaches. Choose another one.',
      );
    }
  }

  async changePassword(
    req: FastifyRequest,
    auth: AuthContext,
    current: string,
    next: string,
  ): Promise<CreatedSession> {
    await this.limits.assertNotBlocked('reauth', auth.user.id);
    const dbUser = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await this.passwords.verify(dbUser.passwordHash, current))) {
      await this.limits.penalize('reauth', auth.user.id);
      throw new AppError('invalid_credentials', 'Invalid password.');
    }
    await this.assertPasswordAcceptable(next);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: dbUser.id },
        data: { passwordHash: await this.passwords.hash(next), passwordChangedAt: new Date() },
      });
      await this.audit.record(
        { ...AuditService.fromRequest(req), action: 'auth.password.changed' },
        tx,
      );
    });
    await this.sessions.destroyAll(dbUser.id, auth.sessionId);
    const rotated = await this.sessions.rotate(auth.sessionId, auth.session, {
      reauthAt: Date.now(),
    });
    await this.mail.send({
      template: 'password_changed',
      to: dbUser.email,
      locale: dbUser.locale,
      params: { name: dbUser.name },
    });
    return rotated;
  }

  async forgotPassword(req: FastifyRequest, email: string): Promise<void> {
    const area = this.requireArea(req);
    await this.limits.consume('forgotIp', req.clientIp);
    const accountKey = RateLimitService.accountKey(email);
    try {
      await this.limits.consume('forgotAccount', accountKey);
    } catch {
      return; // Silently drop: the response must not reveal anything.
    }
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE' || areaForRole(user.role) !== area) {
      await this.audit.record({
        ...AuditService.fromRequest(req),
        action: 'auth.password.reset_requested',
        data: { matched: false, emailHash: accountKey },
      });
      return;
    }
    const token = newToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + this.config.PASSWORD_RESET_TTL_MINUTES * 60_000),
        },
      });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'auth.password.reset_requested',
          targetType: 'user',
          targetId: user.id,
          organizationId: user.organizationId,
          data: { matched: true },
        },
        tx,
      );
    });
    await this.mail.send({
      template: 'password_reset',
      to: user.email,
      locale: user.locale,
      params: {
        name: user.name,
        link: this.mail.link(area, '/restablecer', token),
        expiresMinutes: this.config.PASSWORD_RESET_TTL_MINUTES,
      },
    });
  }

  async resetPassword(req: FastifyRequest, token: string, password: string): Promise<void> {
    const area = this.requireArea(req);
    await this.limits.consume('tokenIp', req.clientIp);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() < Date.now() ||
      record.user.status !== 'ACTIVE' ||
      areaForRole(record.user.role) !== area
    ) {
      throw new AppError('token_invalid');
    }
    await this.assertPasswordAcceptable(password);
    const { user } = record;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new AppError('token_invalid');
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.passwords.hash(password), passwordChangedAt: new Date() },
      });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'auth.password.reset',
          targetType: 'user',
          targetId: user.id,
          organizationId: user.organizationId,
        },
        tx,
      );
    });
    await this.sessions.destroyAll(user.id);
    await this.mail.send({
      template: 'password_changed',
      to: user.email,
      locale: user.locale,
      params: { name: user.name },
    });
  }

  // --------------------------------------------------------- invitations

  private async findUsableInvitation(token: string, area: HostArea) {
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { organization: true },
    });
    if (
      !inv ||
      inv.acceptedAt ||
      inv.revokedAt ||
      inv.expiresAt.getTime() < Date.now() ||
      !inv.organization.active ||
      areaForRole(inv.role) !== area
    ) {
      throw new AppError('token_invalid');
    }
    return inv;
  }

  async inspectInvitation(
    req: FastifyRequest,
    token: string,
  ): Promise<{ email: string; name: string; organizationName: string }> {
    await this.limits.consume('tokenIp', req.clientIp);
    const inv = await this.findUsableInvitation(token, this.requireArea(req));
    return { email: inv.email, name: inv.name, organizationName: inv.organization.name };
  }

  async acceptInvitation(
    req: FastifyRequest,
    token: string,
    name: string,
    password: string,
  ): Promise<void> {
    const area = this.requireArea(req);
    await this.limits.consume('tokenIp', req.clientIp);
    const inv = await this.findUsableInvitation(token, area);
    await this.assertPasswordAcceptable(password);
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: { id: inv.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new AppError('token_invalid');
      if (await tx.user.findUnique({ where: { email: inv.email } }))
        throw new AppError('token_invalid');
      const user = await tx.user.create({
        data: {
          email: inv.email,
          name,
          role: inv.role,
          organizationId: inv.organizationId,
          passwordHash,
        },
      });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          actorType: 'user',
          actorUserId: user.id,
          action: 'auth.invitation.accepted',
          targetType: 'invitation',
          targetId: inv.id,
          organizationId: inv.organizationId,
          data: { role: inv.role },
        },
        tx,
      );
    });
  }
}
