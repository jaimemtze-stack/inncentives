import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.factory';
import { type AppConfig } from '../src/config/config';
import { MAIL_QUEUE, type MailQueue, type TransactionalMail } from '../src/common/mail/mail-queue';
import { HIBP_FETCH, type Fetcher } from '../src/modules/auth/password.service';
import { RedisService } from '../src/common/redis/redis.service';
import { createLogger } from '../src/common/logger';
import { seedBase } from '../src/seed/base';
import { FieldCrypto } from '../src/common/crypto/field-crypto';
import { generateTotpSecret, hotp, base32Decode, totpStep } from '../src/modules/auth/totp';

export const PORTAL = 'soporte.test';
export const AGENT = 'agentes.soporte.test';
export const PASSWORD = 'una frase de prueba larga';

const keys = [randomBytes(32), randomBytes(32)];

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: 'test',
    PORT: 0,
    LOG_LEVEL: 'silent',
    PORTAL_HOST: PORTAL,
    AGENT_HOST: AGENT,
    PORTAL_URL: `https://${PORTAL}`,
    AGENT_URL: `https://${AGENT}`,
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
    COOKIE_SECURE: true,
    TRUST_CLOUDFLARE: false,
    SESSION_IDLE_MINUTES: 30,
    SESSION_ABSOLUTE_HOURS: 12,
    REAUTH_MAX_AGE_MINUTES: 5,
    INVITATION_TTL_HOURS: 72,
    PASSWORD_RESET_TTL_MINUTES: 30,
    HIBP_ENABLED: true,
    RATE_LIMIT_PER_MINUTE: 10_000,
    BODY_LIMIT_BYTES: 1_048_576,
    TICKET_SUBJECT_PREFIX: 'Ticket#',
    TIMEZONE: 'America/Mexico_City',
    PRODUCT_NAME: 'Soporte Inncentives',
    databaseUrl:
      process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/inn_support_test',
    fieldEncryptionKeys: keys,
    csrfSecret: randomBytes(32),
    ...overrides,
  };
}

export class MemoryMailQueue implements MailQueue {
  sent: TransactionalMail[] = [];
  async enqueue(mail: TransactionalMail) {
    this.sent.push(mail);
  }
  last(template?: string) {
    return [...this.sent].reverse().find((m) => !template || m.template === template);
  }
}

/** Fake HIBP: the password "password1234" (and anything in `breached`) is reported as breached. */
export function fakeHibp(breached = ['password1234']): Fetcher {
  return async (url: string) => {
    const prefix = url.slice(-5);
    const lines = breached
      .map((p) => createHash('sha1').update(p).digest('hex').toUpperCase())
      .filter((h) => h.startsWith(prefix))
      .map((h) => `${h.slice(5)}:42`);
    return {
      ok: true,
      text: async () => [...lines, '0000000000000000000000000000000000A:0'].join('\r\n'),
    };
  };
}

export interface TestContext {
  app: NestFastifyApplication;
  prisma: PrismaClient;
  mail: MemoryMailQueue;
  config: AppConfig;
  crypto: FieldCrypto;
  close(): Promise<void>;
}

export async function createTestContext(overrides: Partial<AppConfig> = {}): Promise<TestContext> {
  const config = testConfig(overrides);
  const mail = new MemoryMailQueue();
  const app = await createApp(config, {
    logger: createLogger('silent'),
    overrideProviders: [
      { provide: MAIL_QUEUE, useValue: mail },
      { provide: HIBP_FETCH, useValue: fakeHibp() },
    ],
  });
  const prisma = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  return {
    app,
    prisma,
    mail,
    config,
    crypto: new FieldCrypto(config.fieldEncryptionKeys),
    async close() {
      await prisma.$disconnect();
      await app.close();
    },
  };
}

/** Wipes all data (test database only) and reloads reference data. */
export async function resetDatabase(ctx: TestContext): Promise<void> {
  if (!ctx.config.databaseUrl.includes('_test'))
    throw new Error('Refusing to reset a non-test database');
  const tables = await ctx.prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await ctx.prisma.$transaction([
    ctx.prisma.$executeRaw`SET LOCAL session_replication_role = replica`,
    // Table names come from pg_tables (not user input); test-only.
    // eslint-disable-next-line no-restricted-properties
    ctx.prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    ),
  ]);
  await ctx.app.get(RedisService).flushdb();
  ctx.mail.sent = [];
  await seedBase(ctx.prisma);
}

export interface CreateUserOptions {
  email: string;
  roles: string[];
  organizationId?: string | null;
  password?: string;
  status?: 'active' | 'invited' | 'blocked';
  mfaSecret?: string;
  sharedOrganization?: boolean;
  groups?: Record<string, Array<'read' | 'create' | 'change' | 'overview' | 'full'>>;
}

export async function createUser(ctx: TestContext, o: CreateUserOptions) {
  const roles = await ctx.prisma.role.findMany({ where: { name: { in: o.roles } } });
  const user = await ctx.prisma.user.create({
    data: {
      email: o.email,
      firstname: 'Test',
      lastname: 'User',
      status: o.status ?? 'active',
      passwordHash: await argon2.hash(o.password ?? PASSWORD, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      }),
      organizationId: o.organizationId ?? null,
      sharedOrganization: o.sharedOrganization ?? false,
      mfaEnabled: !!o.mfaSecret,
      mfaSecretEnc: undefined,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
  if (o.mfaSecret) {
    await ctx.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecretEnc: ctx.crypto.encrypt(o.mfaSecret, `totp:${user.id}`) },
    });
  }
  for (const [groupName, levels] of Object.entries(o.groups ?? {})) {
    const g = await ctx.prisma.group.findUniqueOrThrow({ where: { name: groupName } });
    await ctx.prisma.groupAccess.create({ data: { userId: user.id, groupId: g.id, levels } });
  }
  return user;
}

export function totpNow(secret: string, offsetSteps = 0): string {
  return hotp(base32Decode(secret), totpStep() + offsetSteps);
}

export { generateTotpSecret };

interface Response {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  body: string;
  json<T = any>(): T; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Minimal browser-like client: per-host cookie jar and automatic CSRF header. */
export class Browser {
  cookies = new Map<string, string>();
  csrf: string | undefined;

  constructor(
    private readonly app: NestFastifyApplication,
    public host: string,
  ) {}

  private store(res: Response) {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
    for (const c of list) {
      const [pair, ...attrs] = c.split(';');
      const idx = pair!.indexOf('=');
      const name = pair!.slice(0, idx).trim();
      const value = pair!.slice(idx + 1).trim();
      const expired = attrs.some(
        (a) => /expires=thu, 01 jan 1970/i.test(a) || /max-age=0/i.test(a),
      );
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
      if (name.endsWith('_csrf') && !expired) this.csrf = value;
    }
  }

  async request(
    method: string,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = (await this.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: method as 'GET',
        url,
        headers: {
          host: this.host,
          ...(cookie ? { cookie } : {}),
          ...(this.csrf && method !== 'GET' ? { 'x-csrf-token': this.csrf } : {}),
          'user-agent': 'vitest-browser',
          ...headers,
        },
        ...(payload !== undefined ? { payload: payload as object } : {}),
      })) as unknown as Response;
    this.store(res);
    return res;
  }

  get(url: string) {
    return this.request('GET', url);
  }
  post(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('POST', url, body ?? {}, headers);
  }
  delete(url: string) {
    return this.request('DELETE', url);
  }

  async bootstrap() {
    await this.get('/api/v1/auth/csrf');
    return this;
  }

  async login(email: string, password = PASSWORD) {
    await this.bootstrap();
    return this.post('/api/v1/auth/login', { email, password });
  }
}
