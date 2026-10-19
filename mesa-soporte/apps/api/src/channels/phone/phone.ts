import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';

/** E.164 form of a phone number (default country Mexico), or null. */
export function normalizePhone(input: string): string | null {
  // Legacy Mexican mobile prefix "+52 1" (dropped in 2019) is still common.
  const cleaned = input
    .trim()
    .replace(/^\+?52[\s-]*1[\s-]*(?=\(?\d{2,3}\)?[\s-]*\d)/, (m) =>
      m.startsWith('+') ? '+52 ' : '52 ',
    );
  const p = parsePhoneNumberFromString(cleaned, 'MX');
  return p && p.isPossible() ? p.number : null;
}

/** National significant digits, for suffix matching against stored numbers. */
export function phoneDigits(input: string): string {
  const p = parsePhoneNumberFromString(input.trim(), 'MX');
  return (p?.nationalNumber ?? input.replace(/\D/g, '')).slice(-10);
}

/** Events of the generic CTI webhook (provider-neutral). */
export const CtiEventSchema = z
  .object({
    event: z.enum(['newCall', 'answer', 'hangup']),
    callId: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[\w.:@-]+$/),
    direction: z.enum(['in', 'out']),
    from: z.string().min(1).max(30),
    to: z.string().min(1).max(30),
    /** Agent e-mail or extension mapped by the provider. */
    user: z.string().max(254).optional(),
    cause: z.string().max(40).optional(),
  })
  .strict();
export type CtiEvent = z.infer<typeof CtiEventSchema>;

/**
 * A telephony provider adapter turns its own payload into CtiEvents. The
 * generic webhook uses the identity adapter; Teams Phone, Twilio or 3CX
 * (phase 3) plug in here.
 */
export interface TelephonyProvider {
  readonly name: string;
  parse(payload: unknown): CtiEvent;
}

export const GenericTelephonyProvider: TelephonyProvider = {
  name: 'generic',
  parse: (payload) => CtiEventSchema.parse(payload),
};
