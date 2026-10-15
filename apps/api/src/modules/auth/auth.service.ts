import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { hasPermission } from '@inn/shared';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import type { Area, SessionInfo } from '../../common/auth/actor';
import { FIELD_CRYPTO, FieldCrypto } from '../../common/crypto/field-crypto';
import { randomToken, sha256 } from '../../common/crypto/tokens';
import { MAIL_QUEUE, type MailQueue } from '../../common/mail/mail-queue';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { LoginThrottleService } from './login-throttle.service';
import { OneTimeTokenService } from './one-time-token.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { generateRecoveryCodes, generateTotpSecret, otpauthUri, verifyTotp } from './totp';
import * as argon2 from 'argon2';

export interface RequestMeta {
  ip: string;
  userAgent: string | null;
  correlationId: string;
  deviceCookie?: string | undefined;
}

export type LoginResult =
  | { status: 'ok'; sessionId: string; session: SessionInfo; newDeviceCookie?: string }
  | { status: 'mfa_required'; sessionId: string; session: SessionInfo }
  | {
      status: 'mfa_setup_required';
      sessionId: string;
      session: SessionInfo;
      newDeviceCookie?: string;
    };

/** Generic error: never reveals whether the account exists, is blocked or uses another area. */
const INVALID = () => new UnauthorizedException('invalid_credentials');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly throttle: LoginThrottleService,
    private readonly tokens: OneTimeTokenService,
    private readonly audit: AuditService,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(MAIL_QUEUE) private readonly mail: MailQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async loadAuthUser(where: { email: string } | { id: string }) {
    return this.prisma.user.findUnique({
      where,
      include: {
        roles: { include: { role: true } },
        organization: { select: { mfaPolicy: true } },
      },
    });
  }

  private permissionsOf(user: NonNullable<Awaited<ReturnType<AuthService['loadAuthUser']>>>) {
    return new Set(user.roles.filter((r) => r.role.active).flatMap((r) => r.role.permissions));
  }

  /** Agents and admins must use MFA; customers depend on their organization policy. */
  private mfaRequired(
    user: NonNullable<Awaited<ReturnType<AuthService['loadAuthUser']>>>,
  ): boolean {
    const perms = this.permissionsOf(user);
    if (hasPermission(perms, 'admin') || hasPermission(perms, 'ticket.agent')) return true;
    return user.organization?.mfaPolicy === 'required';
  }

  /** Which area a user may sign in to. */
  private allowedIn(perms: Set<string>, area: Area): boolean {
    if (area === 'agent')
      return [...perms].some(
        (p) => p === 'admin' || p.startsWith('admin.') || p === 'ticket.agent',
      );
    return hasPermission(perms, 'ticket.customer');
  }

  async login(
    email: string,
    password: string,
    area: Area,
    meta: RequestMeta,
  ): Promise<LoginResult> {
    const decision = await this.throttle.check('login', email, meta.ip);
    if (!decision.allowed) {
      await this.audit.record({
        action: 'auth.login.locked',
        objectType: 'User',
        ip: meta.ip,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
        after: { area },
      });
      throw new HttpException(
        { statusCode: 429, message: 'too_many_attempts' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (decision.delayMs) await sleep(decision.delayMs);

    const user = await this.loadAuthUser({ email });
    const valid = await this.passwords.verify(user?.passwordHash, password);
    const perms = user ? this.permissionsOf(user) : new Set<string>();
    if (!user || !valid || user.status !== 'active' || !this.allowedIn(perms, area)) {
      const locked = await this.throttle.fail('login', email, meta.ip);
      await this.audit.record({
        action: locked ? 'auth.login.locked' : 'auth.login.failure',
        actorId: null,
        objectType: user ? 'User' : undefined,
        objectId: user?.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
        after: { area },
      });
      throw INVALID();
    }
    await this.throttle.succeed('login', email);

    if (this.passwords.needsRehash(user.passwordHash!)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.passwords.hash(password) },
      });
    }

    const mfaPending = user.mfaEnabled;
    const mfaSetupRequired = !user.mfaEnabled && this.mfaRequired(user);
    const { id, info } = await this.sessions.create({
      userId: user.id,
      area,
      mfaPending,
      mfaSetupRequired,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    if (mfaPending) return { status: 'mfa_required', sessionId: id, session: info };

    const newDeviceCookie = await this.completeLogin(user.id, user.email, user.locale, meta);
    return mfaSetupRequired
      ? { status: 'mfa_setup_required', sessionId: id, session: info, newDeviceCookie }
      : { status: 'ok', sessionId: id, session: info, newDeviceCookie };
  }

  /** Final step of a successful login: audit, last login and unknown-device notification. */
  private async completeLogin(
    userId: string,
    email: string,
    locale: string,
    meta: RequestMeta,
  ): Promise<string | undefined> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      action: 'auth.login.success',
      actorId: userId,
      objectType: 'User',
      objectId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    const fp =
      meta.deviceCookie && /^[A-Za-z0-9_-]{43}$/.test(meta.deviceCookie)
        ? sha256(meta.deviceCookie)
        : null;
    if (fp) {
      const known = await this.prisma.knownDevice.findUnique({
        where: { userId_fingerprint: { userId, fingerprint: fp } },
      });
      if (known) {
        await this.prisma.knownDevice.update({
          where: { id: known.id },
          data: { lastSeenAt: new Date() },
        });
        return undefined;
      }
    }
    const cookie = fp ? meta.deviceCookie! : randomToken(32);
    await this.prisma.knownDevice.create({
      data: { userId, fingerprint: sha256(cookie), userAgent: meta.userAgent?.slice(0, 300) },
    });
    const deviceCount = await this.prisma.knownDevice.count({ where: { userId } });
    if (deviceCount > 1) {
      await this.mail.enqueue({
        template: 'new_device_login',
        to: email,
        locale,
        vars: { userAgent: (meta.userAgent ?? '').slice(0, 120), date: new Date().toISOString() },
      });
    }
    return cookie;
  }

  /** Verifies TOTP or a recovery code for a pending session and rotates the session id. */
  async verifyMfa(session: SessionInfo, code: string, meta: RequestMeta) {
    const decision = await this.throttle.check('mfa', session.userId, meta.ip);
    if (!decision.allowed)
      throw new HttpException(
        { statusCode: 429, message: 'too_many_attempts' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const user = await this.loadAuthUser({ id: session.userId });
    if (!user || user.status !== 'active' || !user.mfaEnabled || !user.mfaSecretEnc)
      throw INVALID();

    const ok = await this.checkSecondFactor(
      user.id,
      user.mfaSecretEnc,
      user.mfaRecoveryCodes,
      code,
    );
    if (!ok) {
      const locked = await this.throttle.fail('mfa', session.userId, meta.ip);
      await this.audit.record({
        action: 'auth.mfa.failure',
        actorId: user.id,
        objectType: 'User',
        objectId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
      });
      if (locked) await this.sessions.destroyByHash(session.hash, session.userId);
      throw INVALID();
    }
    await this.throttle.succeed('mfa', session.userId);
    await this.audit.record({
      action: 'auth.mfa.success',
      actorId: user.id,
      objectType: 'User',
      objectId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });
    const rotated = await this.sessions.rotate(session, {
      mfaPending: false,
      mfaSetupRequired: false,
      reauthAt: Date.now(),
    });
    const newDeviceCookie = await this.completeLogin(user.id, user.email, user.locale, meta);
    return { ...rotated, newDeviceCookie };
  }

  private async checkSecondFactor(
    userId: string,
    secretEnc: string,
    recovery: string[],
    code: string,
  ): Promise<boolean> {
    if (/^\d{6}$/.test(code)) {
      const secret = this.crypto.decrypt(secretEnc, `totp:${userId}`);
      const step = verifyTotp(secret, code);
      if (step === null) return false;
      // Replay protection: a code (time step) can be used only once.
      const fresh = await this.redis.set(`totp:used:${userId}:${step}`, '1', 'EX', 120, 'NX');
      return fresh === 'OK';
    }
    for (const [i, h] of recovery.entries()) {
      if (await argon2.verify(h, code).catch(() => false)) {
        const remaining = recovery.filter((_, j) => j !== i);
        await this.prisma.user.update({
          where: { id: userId },
          data: { mfaRecoveryCodes: remaining },
        });
        return true;
      }
    }
    return false;
  }

  /** Starts MFA enrollment: stores a provisional secret in Redis for 10 minutes. */
  async beginMfaSetup(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = generateTotpSecret();
    await this.redis.set(
      `mfa:setup:${userId}`,
      this.crypto.encrypt(secret, `mfa-setup:${userId}`),
      'EX',
      600,
    );
    return { secret, otpauthUri: otpauthUri(secret, user.email, this.config.PRODUCT_NAME) };
  }

  async enableMfa(session: SessionInfo, code: string, meta: RequestMeta) {
    const enc = await this.redis.get(`mfa:setup:${session.userId}`);
    if (!enc) throw new BadRequestException('mfa_setup_expired');
    const secret = this.crypto.decrypt(enc, `mfa-setup:${session.userId}`);
    if (verifyTotp(secret, code) === null) throw new BadRequestException('mfa_code_invalid');
    const codes = generateRecoveryCodes();
    const hashes = await Promise.all(codes.map((c) => this.passwords.hash(c)));
    const user = await this.prisma.user.update({
      where: { id: session.userId },
      data: {
        mfaEnabled: true,
        mfaSecretEnc: this.crypto.encrypt(secret, `totp:${session.userId}`),
        mfaRecoveryCodes: hashes,
      },
    });
    await this.redis.del(`mfa:setup:${session.userId}`);
    await this.audit.record({
      action: 'auth.mfa.enabled',
      actorId: user.id,
      objectType: 'User',
      objectId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });
    await this.mail.enqueue({
      template: 'mfa_changed',
      to: user.email,
      locale: user.locale,
      vars: { change: 'enabled' },
    });
    // Privilege change → rotate; other sessions are revoked.
    await this.sessions.revokeAll(user.id, session.hash);
    const rotated = await this.sessions.rotate(session, {
      mfaSetupRequired: false,
      reauthAt: Date.now(),
    });
    return { ...rotated, recoveryCodes: codes };
  }

  async reauthenticate(
    session: SessionInfo,
    password: string,
    code: string | undefined,
    meta: RequestMeta,
  ) {
    const decision = await this.throttle.check('reauth', session.userId, meta.ip);
    if (!decision.allowed)
      throw new HttpException(
        { statusCode: 429, message: 'too_many_attempts' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const user = await this.loadAuthUser({ id: session.userId });
    let ok = !!user && (await this.passwords.verify(user.passwordHash, password));
    if (ok && user!.mfaEnabled) {
      ok =
        !!code &&
        (await this.checkSecondFactor(user!.id, user!.mfaSecretEnc!, user!.mfaRecoveryCodes, code));
    }
    if (!ok) {
      await this.throttle.fail('reauth', session.userId, meta.ip);
      throw INVALID();
    }
    await this.throttle.succeed('reauth', session.userId);
    await this.audit.record({
      action: 'auth.reauth',
      actorId: session.userId,
      objectType: 'User',
      objectId: session.userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });
    return this.sessions.rotate(session, { reauthAt: Date.now() });
  }

  async setPasswordChecked(password: string) {
    if (await this.passwords.isBreached(password))
      throw new BadRequestException('password_breached');
    return this.passwords.hash(password);
  }

  async changePassword(session: SessionInfo, current: string, next: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    if (!(await this.passwords.verify(user.passwordHash, current))) {
      await this.throttle.fail('reauth', session.userId, meta.ip);
      throw INVALID();
    }
    const hash = await this.setPasswordChecked(next);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash, passwordChangedAt: new Date() },
    });
    await this.sessions.revokeAll(user.id, session.hash);
    await this.audit.record({
      action: 'auth.password.changed',
      actorId: user.id,
      objectType: 'User',
      objectId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });
    await this.mail.enqueue({
      template: 'password_changed',
      to: user.email,
      locale: user.locale,
      vars: {},
    });
    return this.sessions.rotate(session);
  }

  /** Always resolves the same way whether or not the account exists. */
  async requestPasswordReset(email: string, area: Area, meta: RequestMeta): Promise<void> {
    const decision = await this.throttle.check('reset', email, meta.ip);
    if (!decision.allowed) return;
    await this.throttle.fail('reset', email, meta.ip); // counts requests, not failures
    const user = await this.loadAuthUser({ email });
    if (!user || user.status !== 'active' || !this.allowedIn(this.permissionsOf(user), area))
      return;
    const token = await this.tokens.issue(
      user.id,
      'password_reset',
      this.config.PASSWORD_RESET_TTL_MINUTES * 60_000,
    );
    const base = area === 'agent' ? this.config.AGENT_URL : this.config.PORTAL_URL;
    await this.mail.enqueue({
      template: 'password_reset',
      to: user.email,
      locale: user.locale,
      vars: {
        link: `${base}/reset-password#token=${token}`,
        minutes: String(this.config.PASSWORD_RESET_TTL_MINUTES),
      },
    });
    await this.audit.record({
      action: 'auth.password.reset_requested',
      objectType: 'User',
      objectId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });
  }

  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    const gate = await this.throttle.check('token', 'any', meta.ip);
    if (!gate.allowed)
      throw new HttpException(
        { statusCode: 429, message: 'too_many_attempts' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const hash = await this.setPasswordChecked(password);
    const userId = await this.tokens.consume(token, 'password_reset');
    if (!userId) {
      await this.throttle.fail('token', 'any', meta.ip);
      throw new BadRequestException('token_invalid');
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash, passwordChangedAt: new Date() },
    });
    await this.sessions.revokeAll(userId);
    await this.audit.record({
      action: 'auth.password.reset',
      actorId: userId,
      objectType: 'User',
      objectId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });
    await this.mail.enqueue({
      template: 'password_changed',
      to: user.email,
      locale: user.locale,
      vars: {},
    });
  }

  async acceptInvitation(
    input: { token: string; password: string; firstname?: string; lastname?: string },
    meta: RequestMeta,
  ): Promise<void> {
    const gate = await this.throttle.check('token', 'any', meta.ip);
    if (!gate.allowed)
      throw new HttpException(
        { statusCode: 429, message: 'too_many_attempts' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const hash = await this.setPasswordChecked(input.password);
    const userId = await this.tokens.consume(input.token, 'invitation');
    if (!userId) {
      await this.throttle.fail('token', 'any', meta.ip);
      throw new BadRequestException('token_invalid');
    }
    const res = await this.prisma.user.updateMany({
      where: { id: userId, status: 'invited' },
      data: {
        status: 'active',
        passwordHash: hash,
        passwordChangedAt: new Date(),
        ...(input.firstname ? { firstname: input.firstname } : {}),
        ...(input.lastname ? { lastname: input.lastname } : {}),
      },
    });
    if (res.count !== 1) throw new BadRequestException('token_invalid');
    await this.audit.record({
      action: 'user.invitation.accepted',
      actorId: userId,
      objectType: 'User',
      objectId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });
  }

  async logout(session: SessionInfo, meta: RequestMeta) {
    await this.sessions.destroyByHash(session.hash, session.userId);
    await this.audit.record({
      action: 'auth.logout',
      actorId: session.userId,
      objectType: 'User',
      objectId: session.userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });
  }
}
