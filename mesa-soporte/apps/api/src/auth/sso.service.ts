import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { areaForRole, type HostArea } from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { SECRETS } from '../config/config.module';
import type { FileSecretsProvider } from '../config/secrets';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { SessionService, type CreatedSession } from '../security/session.service';
import { SettingsService, type SettingDefaults } from '../settings/settings.service';
import { AuthService } from './auth.service';

type Provider = (typeof SettingDefaults)['sso_providers'][number];

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface PendingLogin {
  provider: string;
  verifier: string;
  nonce: string;
  mode: 'login' | 'link';
  area: HostArea;
  userId?: string;
}

const STATE_TTL = 600;
const MFA_AMR = ['mfa', 'otp', 'hwk', 'swk', 'fido', 'sc'];

const b64url = (b: Buffer) => b.toString('base64url');

/**
 * Generic OpenID Connect sign-in (authorization code + PKCE). SSO never
 * provisions accounts: an identity (issuer + subject) must first be linked by
 * the signed-in user, and only then can it be used to sign in.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private discovery = new Map<string, { doc: Discovery; jwks: JWTVerifyGetKey; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SECRETS) private readonly secrets: FileSecretsProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Overridable in tests (local identity provider over plain HTTP). */
  http: typeof fetch = fetch;

  async providers(area: HostArea) {
    return (await this.settings.get('sso_providers'))
      .filter((p) => p.area === area)
      .map((p) => ({ id: p.id, label: p.label }));
  }

  private async provider(id: string, area: HostArea): Promise<Provider> {
    const p = (await this.settings.get('sso_providers')).find(
      (x) => x.id === id && x.area === area,
    );
    if (!p) throw new AppError('not_found');
    return p;
  }

  private async meta(p: Provider) {
    const hit = this.discovery.get(p.issuer);
    if (hit && Date.now() - hit.at < 3_600_000) return hit;
    const issuer = new URL(p.issuer);
    if (issuer.protocol !== 'https:' && this.config.NODE_ENV === 'production')
      throw new Error('OIDC issuer must use HTTPS');
    const res = await this.http(`${p.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, {
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`OIDC discovery failed (${res.status})`);
    const doc = (await res.json()) as Discovery;
    if (doc.issuer !== p.issuer) throw new Error('OIDC discovery issuer mismatch');
    const entry = { doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)), at: Date.now() };
    this.discovery.set(p.issuer, entry);
    return entry;
  }

  private redirectUri(req: FastifyRequest, id: string) {
    return `${this.config.PUBLIC_SCHEME}://${req.headers.host}/api/v1/auth/sso/${id}/callback`;
  }

  /** Returns the authorization URL; "link" needs a signed-in, recently re-authenticated user. */
  async start(req: FastifyRequest, id: string, mode: 'login' | 'link'): Promise<{ url: string }> {
    const area = req.area!;
    const p = await this.provider(id, area);
    if (mode === 'link') {
      const s = req.auth?.session;
      if (!s || s.state !== 'authenticated') throw new AppError('unauthenticated');
      if (!s.reauthAt || Date.now() - s.reauthAt > this.config.REAUTH_WINDOW_MINUTES * 60_000)
        throw new AppError('reauthentication_required');
    }
    const { doc } = await this.meta(p);
    const state = b64url(randomBytes(32));
    const verifier = b64url(randomBytes(32));
    const nonce = b64url(randomBytes(32));
    const pending: PendingLogin = {
      provider: id,
      verifier,
      nonce,
      mode,
      area,
      userId: mode === 'link' ? req.auth!.user.id : undefined,
    };
    await this.redis.set(`sso:state:${state}`, JSON.stringify(pending), 'EX', STATE_TTL);
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: p.clientId,
      redirect_uri: this.redirectUri(req, id),
      scope: p.scopes,
      state,
      nonce,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString() };
  }

  /**
   * Callback: exchanges the code, verifies the ID token (signature via JWKS,
   * issuer, audience, expiry, nonce) and either links the identity or signs
   * in the account already linked to it.
   */
  async callback(
    req: FastifyRequest,
    id: string,
    q: { code?: string; state?: string; error?: string },
  ): Promise<{ redirect: string; session?: CreatedSession }> {
    const fail = (reason: string) => {
      this.logger.warn(`sso ${id} failed: ${reason}`);
      void this.audit.record({
        ...AuditService.fromRequest(req),
        action: 'auth.sso.failed',
        data: { provider: id, reason },
      });
      return { redirect: '/entrar?sso=error' };
    };
    if (!q.state || !/^[A-Za-z0-9_-]{43}$/.test(q.state)) return fail('state');
    const raw = await this.redis.getdel(`sso:state:${q.state}`);
    if (!raw) return fail('state');
    const pending = JSON.parse(raw) as PendingLogin;
    if (pending.provider !== id || pending.area !== req.area) return fail('state');
    if (q.error || !q.code) return fail('denied');
    const p = await this.provider(id, pending.area);
    const secret = this.secrets.get(p.secretName);
    if (!secret) return fail('secret');

    let claims: Record<string, unknown>;
    try {
      const { doc, jwks } = await this.meta(p);
      const res = await this.http(doc.token_endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: q.code,
          redirect_uri: this.redirectUri(req, id),
          client_id: p.clientId,
          client_secret: secret,
          code_verifier: pending.verifier,
        }),
      });
      if (!res.ok) return fail(`token ${res.status}`);
      const token = (await res.json()) as { id_token?: string };
      if (!token.id_token) return fail('no id_token');
      const v = await jwtVerify(token.id_token, jwks, {
        issuer: p.issuer,
        audience: p.clientId,
        algorithms: ['RS256', 'PS256', 'ES256'],
        clockTolerance: 60,
      });
      claims = v.payload as Record<string, unknown>;
    } catch (err) {
      return fail((err as Error).message.slice(0, 120));
    }
    if (claims.nonce !== pending.nonce || typeof claims.sub !== 'string' || !claims.sub)
      return fail('nonce');
    const subject = claims.sub;
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;

    if (pending.mode === 'link') {
      const taken = await this.prisma.userIdentity.findUnique({
        where: { issuer_subject: { issuer: p.issuer, subject } },
      });
      if (taken && taken.userId !== pending.userId)
        return fail('identity linked to another account');
      await this.prisma.userIdentity.upsert({
        where: { userId_provider: { userId: pending.userId!, provider: id } },
        create: { userId: pending.userId!, provider: id, issuer: p.issuer, subject, email },
        update: { issuer: p.issuer, subject, email },
      });
      await this.audit.record({
        ...AuditService.fromRequest(req),
        actorType: 'user',
        actorUserId: pending.userId,
        action: 'auth.sso.linked',
        data: { provider: id },
      });
      return { redirect: '/cuenta?sso=linked' };
    }

    const identity = await this.prisma.userIdentity.findUnique({
      where: { issuer_subject: { issuer: p.issuer, subject } },
      include: { user: true },
    });
    const user = identity?.user;
    if (!user || user.status !== 'ACTIVE' || areaForRole(user.role) !== pending.area)
      return fail('no linked account');
    const amr = Array.isArray(claims.amr) ? (claims.amr as unknown[]).map(String) : [];
    const idpMfa = p.trustIdpMfa && amr.some((m) => MFA_AMR.includes(m));
    const state = idpMfa ? 'authenticated' : await this.auth.stateAfterPrimary(user);
    const session = await this.sessions.create({
      userId: user.id,
      area: pending.area,
      state,
      ip: req.clientIp,
      userAgent:
        typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent'].slice(0, 400)
          : null,
      reauthAt: Date.now(),
    });
    await this.prisma.userIdentity.update({
      where: { id: identity!.id },
      data: { lastUsedAt: new Date() },
    });
    await this.audit.record({
      ...AuditService.fromRequest(req),
      actorType: 'user',
      actorUserId: user.id,
      action: 'auth.sso.login',
      organizationId: user.organizationId,
      data: { provider: id, next: state, idpMfa },
    });
    if (state === 'authenticated') await this.auth.onFullyAuthenticated(req, user);
    return {
      redirect:
        state === 'authenticated'
          ? '/'
          : state === 'mfa_required'
            ? '/verificar'
            : '/configurar-mfa',
      session,
    };
  }

  async identities(userId: string) {
    const rows = await this.prisma.userIdentity.findMany({ where: { userId } });
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      email: r.email,
      lastUsedAt: r.lastUsedAt,
      createdAt: r.createdAt,
    }));
  }

  async unlink(req: FastifyRequest, userId: string, id: string) {
    const res = await this.prisma.userIdentity.deleteMany({ where: { id, userId } });
    if (!res.count) throw new AppError('not_found');
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'auth.sso.unlinked',
      data: { identityId: id },
    });
  }
}
