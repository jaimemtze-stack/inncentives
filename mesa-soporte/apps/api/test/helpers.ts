import { randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MailJob } from '@mesa/shared';
import { Algorithm, hash } from '@node-rs/argon2';
import { authenticator } from 'otplib';
import { vi } from 'vitest';
import { createApp } from '../src/bootstrap';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

export const PORTAL = 'soporte.test';
export const AGENT = 'agentes.soporte.test';
export const PASSWORD = 'una frase de prueba larga 2026';

export interface TestApp {
  app: NestFastifyApplication;
  prisma: PrismaService;
  mails: MailJob[];
  close(): Promise<void>;
}

export async function startApp(): Promise<TestApp> {
  const app = await createApp();
  const mails: MailJob[] = [];
  const mail = app.get(MailService);
  vi.spyOn(mail, 'send').mockImplementation(async (job: MailJob) => {
    mails.push(job);
  });
  return { app, prisma: app.get(PrismaService), mails, close: () => app.close() };
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${randomBytes(4).toString('hex')}@example.test`;
}

let passwordHashCache: Promise<string> | undefined;
export function passwordHash(): Promise<string> {
  passwordHashCache ??= hash(PASSWORD, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  return passwordHashCache;
}

export async function makeOrg(
  prisma: PrismaService,
  opts: { internal?: boolean; mfaRequired?: boolean } = {},
) {
  return prisma.organization.create({
    data: {
      name: `Org ${randomBytes(3).toString('hex')}`,
      isInternal: opts.internal ?? false,
      mfaRequiredForCustomers: opts.mfaRequired ?? false,
    },
  });
}

export async function makeUser(
  prisma: PrismaService,
  role: 'ADMIN' | 'AGENT' | 'CUSTOMER',
  organizationId: string,
) {
  return prisma.user.create({
    data: {
      email: uniqueEmail(role.toLowerCase()),
      name: `${role} test`,
      role,
      organizationId,
      passwordHash: await passwordHash(),
    },
  });
}

interface Res {
  statusCode: number;
  json: <T = any>() => T; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Record<string, string | string[] | number | undefined>;
}

/** A browser-like client bound to one host: keeps its cookie and CSRF token. */
export class Client {
  cookie?: string;
  csrf?: string;
  ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

  constructor(
    private readonly app: NestFastifyApplication,
    readonly host: string,
  ) {}

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    opts: { origin?: string | null; csrf?: string | null; headers?: Record<string, string> } = {},
  ): Promise<Res> {
    const headers: Record<string, string> = {
      host: this.host,
      'user-agent': 'vitest',
      'x-forwarded-for': this.ip,
      ...(opts.headers ?? {}),
    };
    if (this.cookie) headers.cookie = `__Host-sid=${this.cookie}`;
    if (method !== 'GET') {
      const origin = opts.origin === undefined ? `https://${this.host}` : opts.origin;
      if (origin) headers.origin = origin;
      const csrf = opts.csrf === undefined ? this.csrf : opts.csrf;
      if (csrf) headers['x-csrf-token'] = csrf;
    }
    const res = await this.app
      .getHttpAdapter()
      .getInstance()
      .inject({ method, url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    for (const c of cookies) {
      const m = /^__Host-sid=([^;]*)/.exec(String(c));
      if (m) this.cookie = m[1] || undefined;
    }
    const parsed = res.body ? safeJson(res.body) : undefined;
    if (parsed && typeof parsed === 'object' && 'csrfToken' in parsed)
      this.csrf = (parsed as { csrfToken: string }).csrfToken;
    return { statusCode: res.statusCode, json: () => parsed as never, headers: res.headers };
  }

  get(url: string) {
    return this.request('GET', url);
  }
  post(url: string, body?: unknown, opts?: Parameters<Client['request']>[3]) {
    return this.request('POST', url, body ?? {}, opts);
  }
  delete(url: string, opts?: Parameters<Client['request']>[3]) {
    return this.request('DELETE', url, undefined, opts);
  }

  async login(email: string, password = PASSWORD) {
    return this.post('/api/v1/auth/login', { email, password });
  }

  /** Login + TOTP enrollment for staff; returns the TOTP secret and recovery codes. */
  async loginAndEnroll(email: string): Promise<{ secret: string; recoveryCodes: string[] }> {
    const login = await this.login(email);
    if (login.json().state !== 'mfa_enrollment_required')
      throw new Error(`Unexpected state ${login.json().state}`);
    const setup = await this.post('/api/v1/auth/mfa/totp/setup');
    const secret = setup.json().secret as string;
    const confirm = await this.post('/api/v1/auth/mfa/totp/confirm', {
      code: authenticator.generate(secret),
    });
    if (confirm.statusCode !== 200)
      throw new Error(`Enrollment failed: ${JSON.stringify(confirm.json())}`);
    return { secret, recoveryCodes: confirm.json().recoveryCodes };
  }
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** Token from the last mail of a template (the link carries it in the fragment). */
export function tokenFromMail(mails: MailJob[], template: MailJob['template'], to: string): string {
  const job = [...mails].reverse().find((m) => m.template === template && m.to === to);
  if (!job || !('link' in job.params)) throw new Error(`No ${template} mail for ${to}`);
  const token = /#token=([A-Za-z0-9_-]{43})$/.exec(job.params.link)?.[1];
  if (!token) throw new Error('No token in link');
  return token;
}
