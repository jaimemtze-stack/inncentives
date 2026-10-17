import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import { APP_CONFIG, AppConfig } from '../config/config';

// OWASP Password Storage Cheat Sheet: Argon2id, m=19 MiB, t=2, p=1.
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  private dummyHash?: Promise<string>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Spend the same time as a real verification so unknown emails are not detectable by timing. */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
  }

  /**
   * Have I Been Pwned k-anonymity check: only the first 5 hex chars of the
   * SHA-1 leave the server. Fails open (logs a warning) when the service is
   * unreachable, so an outage never blocks sign-ups.
   */
  async isBreached(password: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
    if (!this.config.PWNED_PASSWORDS_CHECK) return false;
    const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const res = await fetchImpl(`${this.config.PWNED_PASSWORDS_URL}${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'mesa-soporte' },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      return body.split('\n').some((line) => {
        const [s, count] = line.trim().split(':');
        return s === suffix && Number(count) > 0;
      });
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'Breached-password check unavailable');
      return false;
    }
  }
}
