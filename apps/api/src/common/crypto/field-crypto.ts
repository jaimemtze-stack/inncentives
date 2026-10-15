import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM field-level encryption for secrets at rest (TOTP seeds, integration secrets).
 * Format: v1.<keyIndex>.<iv>.<tag>.<ciphertext> (base64url). Key 0 encrypts; any key decrypts.
 */
const TAG_BYTES = 16;

export class FieldCrypto {
  constructor(private readonly keys: Buffer[]) {
    if (keys.length === 0) throw new Error('At least one encryption key is required');
    for (const k of keys) if (k.length !== 32) throw new Error('Keys must be 32 bytes');
  }

  encrypt(plaintext: string, aad = ''): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys[0]!, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      '0',
      iv.toString('base64url'),
      tag.toString('base64url'),
      ct.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string, aad = ''): string {
    const parts = payload.split('.');
    if (parts.length !== 5 || parts[0] !== 'v1') throw new Error('Unsupported ciphertext format');
    const [, idx, iv, tag, ct] = parts as [string, string, string, string, string];
    const tagBuf = Buffer.from(tag, 'base64url');
    // A truncated tag would weaken GCM authentication: require the full 128 bits.
    if (tagBuf.length !== TAG_BYTES) throw new Error('Invalid authentication tag');
    const errors: unknown[] = [];
    // Try the declared key first, then the others (supports re-indexed rotations).
    const order = [Number(idx), ...this.keys.map((_, i) => i).filter((i) => i !== Number(idx))];
    for (const i of order) {
      const key = this.keys[i];
      if (!key) continue;
      try {
        const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
          authTagLength: TAG_BYTES,
        });
        d.setAAD(Buffer.from(aad));
        d.setAuthTag(tagBuf);
        return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
      } catch (e) {
        errors.push(e);
      }
    }
    throw new Error('Unable to decrypt field');
  }
}

export const FIELD_CRYPTO = Symbol('FIELD_CRYPTO');
