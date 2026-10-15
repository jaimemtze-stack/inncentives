import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { randomToken, safeEqual } from '../crypto/tokens';

/**
 * Signed double-submit CSRF token bound to the session (OWASP CSRF Cheat Sheet).
 * token = nonce "." HMAC(secret, nonce "." binding); binding = session hash or "anon".
 * The same value is sent as a cookie and echoed in the X-CSRF-Token header.
 */
@Injectable()
export class CsrfService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private sign(nonce: string, binding: string) {
    return createHmac('sha256', this.config.csrfSecret)
      .update(`${nonce}.${binding}`)
      .digest('base64url');
  }

  issue(binding: string): string {
    const nonce = randomToken(16);
    return `${nonce}.${this.sign(nonce, binding)}`;
  }

  verify(
    cookieToken: string | undefined,
    headerToken: string | undefined,
    binding: string,
  ): boolean {
    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) return false;
    const [nonce, sig, extra] = headerToken.split('.');
    if (!nonce || !sig || extra !== undefined) return false;
    return safeEqual(sig, this.sign(nonce, binding));
  }
}
