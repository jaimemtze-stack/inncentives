const TIMEOUT_MS = 15_000;

/** Meta Graph API for WhatsApp Business (Cloud API). */
export class WhatsAppClient {
  constructor(
    private readonly accessToken: string,
    private readonly apiVersion: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string) {
    return `https://graph.facebook.com/${this.apiVersion}/${path}`;
  }

  /** Free-form text; only allowed within 24 h of the customer's last message. */
  async sendText(phoneNumberId: string, to: string, body: string): Promise<string> {
    const res = await this.fetchImpl(this.url(`${encodeURIComponent(phoneNumberId)}/messages`), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/^\+/, ''),
        type: 'text',
        text: { body, preview_url: false },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { code?: number; message?: string };
    };
    if (!res.ok || !data.messages?.[0]?.id)
      throw new Error(`WhatsApp send failed: HTTP ${res.status} ${data.error?.code ?? ''}`.trim());
    return `wa:${data.messages[0].id}`;
  }

  /** Downloads an inbound media object (URL valid for 5 minutes, bearer-protected). */
  async download(mediaId: string, maxBytes: number): Promise<{ buffer: Buffer; mimeType: string }> {
    const meta = await this.fetchImpl(this.url(encodeURIComponent(mediaId)), {
      headers: { authorization: `Bearer ${this.accessToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const info = (await meta.json().catch(() => ({}))) as {
      url?: string;
      mime_type?: string;
      file_size?: number;
    };
    if (!meta.ok || !info.url) throw new Error(`WhatsApp media lookup failed: HTTP ${meta.status}`);
    const u = new URL(info.url);
    // The bearer token is only ever sent to Meta's own media hosts.
    if (
      u.protocol !== 'https:' ||
      !/(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net)$/.test(u.hostname)
    )
      throw new Error('Unexpected media host');
    if ((info.file_size ?? 0) > maxBytes) throw new Error('Media too large');
    const file = await this.fetchImpl(u, {
      headers: { authorization: `Bearer ${this.accessToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    });
    if (!file.ok) throw new Error(`WhatsApp media download failed: HTTP ${file.status}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('Media too large');
    return { buffer, mimeType: info.mime_type ?? 'application/octet-stream' };
  }
}

/** Twilio Programmable Messaging. */
export class TwilioSmsClient {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(from: string, to: string, body: string, statusCallback: string): Promise<string> {
    const res = await this.fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: from,
          To: to,
          Body: body,
          StatusCallback: statusCallback,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const data = (await res.json().catch(() => ({}))) as { sid?: string; code?: number };
    if (!res.ok || !data.sid)
      throw new Error(`Twilio send failed: HTTP ${res.status} ${data.code ?? ''}`.trim());
    return `tw:${data.sid}`;
  }
}
