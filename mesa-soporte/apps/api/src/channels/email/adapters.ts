import type { EmailChannel } from '@prisma/client';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { z } from 'zod';

/** Non-secret channel settings stored in email_channels.config. */
export const ImapConfigSchema = z
  .object({
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535).default(993),
    secure: z.boolean().default(true),
    user: z.string().min(1).max(254),
    mailbox: z.string().max(200).default('INBOX'),
    /** Folder for processed mail; when unset messages are only flagged as seen. */
    processedMailbox: z.string().max(200).optional(),
    smtp: z
      .object({
        host: z.string().min(1).max(253),
        port: z.number().int().min(1).max(65535).default(587),
        /** implicit TLS (465) or STARTTLS (587). */
        secure: z.boolean().default(false),
        user: z.string().max(254).optional(),
      })
      .strict(),
    allowUnauthenticated: z.boolean().optional(),
    /** Development only: plain connections (GreenMail / Mailpit). */
    insecureTls: z.boolean().optional(),
  })
  .strict();

export const GraphConfigSchema = z
  .object({
    tenantId: z.string().uuid(),
    clientId: z.string().uuid(),
    mailbox: z.string().email(),
    folder: z.string().max(100).default('inbox'),
    allowUnauthenticated: z.boolean().optional(),
  })
  .strict();

export type ImapConfig = z.infer<typeof ImapConfigSchema>;
export type GraphConfig = z.infer<typeof GraphConfigSchema>;

export interface MailboxAdapter {
  /** Fetches new messages, handing each raw MIME to `handle`; marks them processed afterwards. */
  fetch(handle: (raw: Buffer) => Promise<void>, max: number): Promise<number>;
  /** Sends a complete MIME message. */
  send(mime: Buffer, envelope: { from: string; to: string[] }): Promise<void>;
}

// ------------------------------------------------------------------- IMAP

export class ImapAdapter implements MailboxAdapter {
  constructor(
    private readonly cfg: ImapConfig,
    private readonly password: string,
    private readonly production: boolean,
  ) {}

  private tls() {
    // Certificate checks can only be relaxed outside production (local test servers).
    return {
      rejectUnauthorized: !(this.cfg.insecureTls && !this.production),
      minVersion: 'TLSv1.2' as const,
    };
  }

  async fetch(handle: (raw: Buffer) => Promise<void>, max: number): Promise<number> {
    const client = new ImapFlow({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.secure,
      auth: { user: this.cfg.user, pass: this.password },
      tls: this.tls(),
      logger: false,
      disableAutoIdle: true,
    });
    await client.connect();
    let n = 0;
    try {
      const lock = await client.getMailboxLock(this.cfg.mailbox);
      try {
        const uids = ((await client.search({ seen: false }, { uid: true })) || []).slice(0, max);
        for (const uid of uids) {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (msg && msg.source) await handle(msg.source);
          if (this.cfg.processedMailbox)
            await client.messageMove(String(uid), this.cfg.processedMailbox, { uid: true });
          else await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
          n++;
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return n;
  }

  async send(mime: Buffer, envelope: { from: string; to: string[] }): Promise<void> {
    const t = nodemailer.createTransport({
      host: this.cfg.smtp.host,
      port: this.cfg.smtp.port,
      secure: this.cfg.smtp.secure,
      requireTLS: !this.cfg.smtp.secure && !(this.cfg.insecureTls && !this.production),
      ignoreTLS: !!(this.cfg.insecureTls && !this.production),
      tls: this.tls(),
      auth: this.cfg.smtp.user ? { user: this.cfg.smtp.user, pass: this.password } : undefined,
    });
    await t.sendMail({ envelope, raw: mime });
  }
}

// ---------------------------------------------------------- Microsoft Graph

const GRAPH = 'https://graph.microsoft.com/v1.0';

export class GraphAdapter implements MailboxAdapter {
  private token?: { value: string; expires: number };

  constructor(
    private readonly cfg: GraphConfig,
    private readonly clientSecret: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const res = await this.http(
      `https://login.microsoftonline.com/${this.cfg.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.cfg.clientId,
          client_secret: this.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
        redirect: 'error',
      },
    );
    if (!res.ok) throw new Error(`Graph token request failed (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.http(`${GRAPH}${path}`, {
      ...init,
      redirect: 'error',
      headers: {
        ...(init.headers as Record<string, string>),
        authorization: `Bearer ${await this.accessToken()}`,
      },
    });
    if (!res.ok) throw new Error(`Graph ${init.method ?? 'GET'} failed (${res.status})`);
    return res;
  }

  async fetch(handle: (raw: Buffer) => Promise<void>, max: number): Promise<number> {
    const box = encodeURIComponent(this.cfg.mailbox);
    const folder = encodeURIComponent(this.cfg.folder);
    const list = (await (
      await this.call(
        `/users/${box}/mailFolders/${folder}/messages?$filter=isRead%20eq%20false&$top=${max}&$select=id&$orderby=receivedDateTime`,
      )
    ).json()) as { value: Array<{ id: string }> };
    let n = 0;
    for (const m of list.value) {
      const id = encodeURIComponent(m.id);
      const raw = Buffer.from(
        await (await this.call(`/users/${box}/messages/${id}/$value`)).arrayBuffer(),
      );
      await handle(raw);
      await this.call(`/users/${box}/messages/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      });
      n++;
    }
    return n;
  }

  async send(mime: Buffer): Promise<void> {
    // Graph accepts a base64 MIME message as text/plain on sendMail.
    await this.call(`/users/${encodeURIComponent(this.cfg.mailbox)}/sendMail`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: mime.toString('base64'),
    });
  }
}

export function adapterFor(
  channel: EmailChannel,
  secret: string | undefined,
  production: boolean,
): MailboxAdapter {
  if (!secret)
    throw new Error(
      `Secret "${channel.secretName ?? '(none)'}" for channel ${channel.name} is missing`,
    );
  if (channel.adapter === 'graph')
    return new GraphAdapter(GraphConfigSchema.parse(channel.config), secret);
  if (channel.adapter === 'imap')
    return new ImapAdapter(ImapConfigSchema.parse(channel.config), secret, production);
  throw new Error(`Unknown adapter ${channel.adapter}`);
}
