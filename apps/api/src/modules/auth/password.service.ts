import { Inject, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../config/config';

export type Fetcher = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  text(): Promise<string>;
}>;
export const HIBP_FETCH = Symbol('HIBP_FETCH');

/** OWASP Password Storage Cheat Sheet: Argon2id, m=19 MiB, t=2, p=1. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  /** Pre-computed hash used to equalize timing when the account does not exist. */
  private dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HIBP_FETCH) private readonly fetcher: Fetcher,
  ) {}

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    if (!hash) {
      this.dummyHash ??= this.hash('dummy-password-for-timing');
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }

  /**
   * Have I Been Pwned k-anonymity: only the first 5 hex chars of SHA-1 leave the server.
   * Fails open (returns false) when the service is unreachable and logs a warning.
   */
  async isBreached(password: string): Promise<boolean> {
    if (!this.config.HIBP_ENABLED) return false;
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const res = await this.fetcher(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'inn-support' },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error('HIBP non-2xx');
      const body = await res.text();
      return body.split('\n').some((line) => {
        const [s, count] = line.trim().split(':');
        return s === suffix && Number(count) > 0;
      });
    } catch {
      this.logger.warn('HIBP check unavailable; password accepted without breach check');
      return false;
    }
  }
}
