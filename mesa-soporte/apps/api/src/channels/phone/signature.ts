import { createHmac } from 'node:crypto';
import { safeEqual } from '../../security/tokens';

export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${rawBody}`>" */
export function signPayload(
  secret: string,
  rawBody: Buffer | string,
  t = Math.floor(Date.now() / 1000),
): string {
  const mac = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  return `t=${t},v1=${mac}`;
}

export function verifySignature(
  secret: string,
  header: string | undefined,
  rawBody: Buffer,
  now = Math.floor(Date.now() / 1000),
): { ok: true; t: number; mac: string } | { ok: false } {
  if (!header || header.length > 300) return { ok: false };
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.trim().split('=', 2) as [string, string]),
  );
  const t = Number(parts.t);
  const mac = parts.v1;
  if (!Number.isInteger(t) || !mac || !/^[0-9a-f]{64}$/.test(mac)) return { ok: false };
  if (Math.abs(now - t) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false };
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  return safeEqual(mac, expected) ? { ok: true, t, mac } : { ok: false };
}
