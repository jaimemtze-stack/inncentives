import { createHmac } from 'node:crypto';
import { safeEqual } from '../../security/tokens';
import type { CtiEvent, TelephonyProvider } from '../phone/phone';

export type TwilioParams = Record<string, string>;

/**
 * X-Twilio-Signature: base64(HMAC-SHA1(auth token, full URL + every POST
 * parameter as key+value, sorted by key)).
 */
export function twilioSignature(authToken: string, url: string, params: TwilioParams): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function verifyTwilio(
  authToken: string,
  url: string,
  params: TwilioParams,
  header: string | undefined,
): boolean {
  if (!header || header.length > 100) return false;
  return safeEqual(header, twilioSignature(authToken, url, params));
}

/** Only flat string parameters (application/x-www-form-urlencoded). */
export function asParams(body: unknown): TwilioParams | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const out: TwilioParams = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (typeof v !== 'string' || k.length > 64 || v.length > 2000) return null;
    out[k] = v;
  }
  return Object.keys(out).length <= 100 ? out : null;
}

const ANSWERED = new Set(['in-progress', 'answered']);
const ENDED = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled']);

/**
 * Twilio Programmable Voice status callbacks → CtiEvent. The agent can be
 * passed as `agent=<e-mail>` in the status callback URL (covered by the
 * signature).
 */
export const TwilioTelephonyProvider: TelephonyProvider & {
  parse(payload: unknown, agent?: string): CtiEvent;
} = {
  name: 'twilio',
  parse(payload: unknown, agent?: string): CtiEvent {
    const p = asParams(payload);
    if (!p || !/^CA[0-9a-f]{32}$/.test(p.CallSid ?? '')) throw new Error('Not a Twilio call');
    const status = p.CallStatus ?? '';
    const event = ENDED.has(status) ? 'hangup' : ANSWERED.has(status) ? 'answer' : 'newCall';
    return {
      event,
      callId: p.CallSid!,
      direction: p.Direction === 'inbound' ? 'in' : 'out',
      from: (p.From ?? '').slice(0, 30) || 'unknown',
      to: (p.To ?? '').slice(0, 30) || 'unknown',
      ...(agent ? { user: agent.slice(0, 254) } : {}),
      ...(event === 'hangup' ? { cause: status } : {}),
    };
  },
};
