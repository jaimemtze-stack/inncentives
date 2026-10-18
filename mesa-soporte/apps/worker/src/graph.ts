/**
 * System mail through Microsoft Graph (`/users/{sender}/sendMail`) with the
 * client-credentials flow, replacing SMTP AUTH. The app registration needs the
 * Mail.Send application permission limited to the sender mailbox (RBAC for
 * Applications in Exchange Online), the same one used by the e-mail channel.
 */
export interface GraphMailConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sender: string;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const LOGIN = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const TIMEOUT_MS = 15_000;

export class GraphMailer {
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly cfg: GraphMailConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.fetchImpl(
      `${LOGIN}/${encodeURIComponent(this.cfg.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`Graph token request failed with HTTP ${res.status}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('Graph token response without access_token');
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  async send(mail: OutgoingMail): Promise<void> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(
      `${GRAPH}/users/${encodeURIComponent(this.cfg.sender)}/sendMail`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: mail.subject,
            body: mail.html
              ? { contentType: 'HTML', content: mail.html }
              : { contentType: 'Text', content: mail.text },
            toRecipients: [{ emailAddress: { address: mail.to } }],
          },
          saveToSentItems: false,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (res.status === 401) this.token = undefined;
    // 202 Accepted on success; the response body is never logged (it may echo the address).
    if (res.status !== 202) throw new Error(`Graph sendMail failed with HTTP ${res.status}`);
  }
}
