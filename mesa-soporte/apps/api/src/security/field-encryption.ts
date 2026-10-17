import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for sensitive columns: "v1:<keyId>:<iv>:<ciphertext>:<tag>".
 * The associated data binds a ciphertext to its row and purpose, so a value
 * copied to another row or column fails to decrypt.
 */
export class FieldEncryption {
  private readonly byId: Map<string, Buffer>;
  private readonly active: { id: string; key: Buffer };

  constructor(keys: { id: string; key: Buffer }[]) {
    if (keys.length === 0) throw new Error('No field encryption keys');
    this.active = keys[0] as { id: string; key: Buffer };
    this.byId = new Map(keys.map((k) => [k.id, k.key]));
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.active.key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      this.active.id,
      iv.toString('base64url'),
      ct.toString('base64url'),
      tag.toString('base64url'),
    ].join(':');
  }

  decrypt(envelope: string, aad: string): string {
    const parts = envelope.split(':');
    if (parts.length !== 5 || parts[0] !== 'v1') throw new Error('Unsupported ciphertext format');
    const [, keyId, iv, ct, tag] = parts as [string, string, string, string, string];
    const key = this.byId.get(keyId);
    if (!key) throw new Error(`Unknown field encryption key: ${keyId}`);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** True when the value was encrypted with an older key and should be re-encrypted. */
  needsRotation(envelope: string): boolean {
    return envelope.split(':')[1] !== this.active.id;
  }
}
