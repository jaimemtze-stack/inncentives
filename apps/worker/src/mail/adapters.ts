import nodemailer from 'nodemailer';

export interface OutboundMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

/** Outbound adapter port (ADR-0004). */
export interface OutboundMailAdapter {
  send(msg: OutboundMessage): Promise<{ messageId: string }>;
}

function assertHeaderSafe(...values: string[]) {
  for (const v of values) if (/[\r\n]/.test(v)) throw new Error('Header injection attempt');
}

/** SMTP (Mailpit in local development, any relay in other environments). */
export class SmtpAdapter implements OutboundMailAdapter {
  private readonly transport;

  constructor(opts: { host: string; port: number; secure: boolean; user?: string; pass?: string }) {
    this.transport = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      requireTLS: opts.secure,
      ...(opts.user ? { auth: { user: opts.user, pass: opts.pass } } : {}),
    });
  }

  async send(msg: OutboundMessage) {
    assertHeaderSafe(msg.from, msg.to, msg.subject);
    const info = await this.transport.sendMail({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: { 'Auto-Submitted': 'auto-generated', ...msg.headers },
    });
    return { messageId: info.messageId };
  }
}

export type TokenProvider = () => Promise<string>;

/**
 * Microsoft Graph sendMail from the support mailbox. Authentication uses Managed Identity /
 * DefaultAzureCredential; the app registration must be restricted to the mailbox with an
 * Application Access Policy.
 */
export class GraphAdapter implements OutboundMailAdapter {
  constructor(
    private readonly mailbox: string,
    private readonly getToken: TokenProvider,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(msg: OutboundMessage) {
    assertHeaderSafe(msg.from, msg.to, msg.subject);
    const token = await this.getToken();
    const res = await this.fetcher(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.mailbox)}/sendMail`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: msg.subject,
            body: { contentType: 'HTML', content: msg.html },
            toRecipients: [{ emailAddress: { address: msg.to } }],
            internetMessageHeaders: Object.entries({
              'X-Auto-Submitted': 'auto-generated',
              ...msg.headers,
            }).map(([name, value]) => ({
              name: name.startsWith('X-') ? name : `X-${name}`,
              value,
            })),
          },
          saveToSentItems: true,
        }),
      },
    );
    if (!res.ok) throw new Error(`Graph sendMail failed with status ${res.status}`);
    return { messageId: res.headers.get('request-id') ?? 'graph' };
  }
}

export async function graphTokenFromAzureIdentity(): Promise<TokenProvider> {
  const { DefaultAzureCredential } = await import('@azure/identity');
  const cred = new DefaultAzureCredential();
  return async () => {
    const t = await cred.getToken('https://graph.microsoft.com/.default');
    if (!t) throw new Error('Unable to acquire Graph token');
    return t.token;
  };
}
