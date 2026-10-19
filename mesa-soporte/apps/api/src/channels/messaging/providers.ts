import { createHmac } from 'node:crypto';
import { safeEqual } from '../../security/tokens';
import { asParams } from '../twilio/twilio';

/** A message received on a WhatsApp or SMS number, provider-neutral. */
export interface InboundMessage {
  kind: 'whatsapp' | 'sms';
  /** WhatsApp phone_number_id or the Twilio number that received it. */
  providerId: string;
  /** Sender in E.164. */
  from: string;
  name: string | null;
  externalId: string;
  text: string;
  media: Array<{ id: string; mimeType: string; filename: string | null }>;
}

/** Delivery receipt of a message we sent. */
export interface DeliveryReceipt {
  externalId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  error: string | null;
}

// ----------------------------------------------------------------- WhatsApp

/** X-Hub-Signature-256: "sha256=" + hex HMAC-SHA256(app secret, raw body). */
export function verifyMetaSignature(
  appSecret: string,
  rawBody: Buffer,
  header: string | undefined,
): boolean {
  const m = /^sha256=([0-9a-f]{64})$/.exec(header ?? '');
  if (!m) return false;
  return safeEqual(m[1]!, createHmac('sha256', appSecret).update(rawBody).digest('hex'));
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

const WA_STATUS: Record<string, DeliveryReceipt['status']> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

/**
 * WhatsApp Cloud API webhook payload (object "whatsapp_business_account").
 * Unknown shapes are skipped, never thrown on: Meta retries failed
 * deliveries for days.
 */
export function parseWhatsApp(payload: unknown): {
  messages: InboundMessage[];
  receipts: DeliveryReceipt[];
} {
  const messages: InboundMessage[] = [];
  const receipts: DeliveryReceipt[] = [];
  const p = payload as { object?: unknown; entry?: unknown };
  if (p?.object !== 'whatsapp_business_account' || !Array.isArray(p.entry))
    return { messages, receipts };
  for (const entry of p.entry.slice(0, 50) as Array<{ changes?: unknown }>) {
    if (!Array.isArray(entry?.changes)) continue;
    // Untrusted JSON walked defensively: every value read goes through str() or a set lookup.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const change of entry.changes.slice(0, 50) as Array<{ field?: unknown; value?: any }>) {
      if (change?.field !== 'messages' || !change.value) continue;
      const v = change.value;
      const providerId = str(v.metadata?.phone_number_id, 64);
      if (!providerId) continue;
      const names = new Map<string, string>();
      for (const c of Array.isArray(v.contacts) ? v.contacts : []) {
        const id = str(c?.wa_id, 20);
        const name = str(c?.profile?.name, 120);
        if (id && name) names.set(id, name);
      }
      for (const m of Array.isArray(v.messages) ? v.messages.slice(0, 100) : []) {
        const from = str(m?.from, 20);
        const id = str(m?.id, 200);
        if (!from || !/^\d{6,20}$/.test(from) || !id) continue;
        const media: InboundMessage['media'] = [];
        let text = '';
        if (m.type === 'text') text = str(m.text?.body, 4096) ?? '';
        else if (['image', 'document', 'audio', 'video', 'sticker'].includes(m.type)) {
          const obj = m[m.type];
          const mid = str(obj?.id, 100);
          const mime = str(obj?.mime_type, 100);
          if (mid && mime)
            media.push({ id: mid, mimeType: mime, filename: str(obj?.filename, 200) });
          text = str(obj?.caption, 1024) ?? '';
        } else if (m.type === 'button') text = str(m.button?.text, 1024) ?? '';
        else if (m.type === 'interactive')
          text =
            str(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title, 1024) ?? '';
        else text = `[${String(m.type).slice(0, 30)}]`;
        messages.push({
          kind: 'whatsapp',
          providerId,
          from: `+${from}`,
          name: names.get(from) ?? null,
          externalId: `wa:${id}`,
          text,
          media,
        });
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses.slice(0, 100) : []) {
        const id = str(s?.id, 200);
        const status = WA_STATUS[String(s?.status)];
        if (!id || !status) continue;
        const err = Array.isArray(s.errors) ? s.errors[0] : null;
        receipts.push({
          externalId: `wa:${id}`,
          status,
          error: err ? `${err.code ?? ''} ${str(err.title, 200) ?? ''}`.trim() : null,
        });
      }
    }
  }
  return { messages, receipts };
}

// ---------------------------------------------------------------- Twilio SMS

const SMS_STATUS: Record<string, DeliveryReceipt['status']> = {
  sent: 'sent',
  delivered: 'delivered',
  undelivered: 'failed',
  failed: 'failed',
};

/** Twilio Messaging webhook: an inbound SMS or a status callback of ours. */
export function parseTwilioSms(
  body: unknown,
): { message: InboundMessage } | { receipt: DeliveryReceipt } | null {
  const p = asParams(body);
  if (!p || !/^(SM|MM)[0-9a-f]{32}$/.test(p.MessageSid ?? '')) return null;
  const externalId = `tw:${p.MessageSid}`;
  if (p.MessageStatus && p.MessageStatus !== 'received') {
    const status = SMS_STATUS[p.MessageStatus];
    return status
      ? { receipt: { externalId, status, error: p.ErrorCode ? `Twilio ${p.ErrorCode}` : null } }
      : null;
  }
  if (!p.From || !p.To) return null;
  const media = Number(p.NumMedia ?? '0') > 0 ? '\n[MMS: adjunto no admitido]' : '';
  return {
    message: {
      kind: 'sms',
      providerId: p.To,
      from: p.From,
      name: null,
      externalId,
      text: (p.Body ?? '').slice(0, 1600) + media,
      media: [],
    },
  };
}
