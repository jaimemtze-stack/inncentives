import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, base64url (43 chars). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const RECOVERY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Recovery code like "k3x9p-2mq7z" (~51 bits of entropy). */
export function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) {
    // 252 = 7 * 36: reject values that would bias the alphabet.
    let b = bytes[i] as number;
    while (b >= 252) b = randomBytes(1)[0] as number;
    out += RECOVERY_ALPHABET[b % 36];
    if (i === 4) out += '-';
  }
  return out;
}
