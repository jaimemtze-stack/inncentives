import { Inject, Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

authenticator.options = { window: 1, step: 30, digits: 6 };

@Injectable()
export class TotpService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  generateSecret(): string {
    return authenticator.generateSecret(20);
  }

  keyUri(accountName: string, issuer: string, secret: string): string {
    return authenticator.keyuri(accountName, issuer, secret);
  }

  /**
   * Verifies a code and rejects its reuse within the acceptance window
   * (ASVS 2.8.4: a time-based OTP can be used only once).
   */
  async verifyOnce(userId: string, secret: string, code: string): Promise<boolean> {
    const delta = authenticator.checkDelta(code, secret);
    if (delta === null) return false;
    const step = Math.floor(Date.now() / 30_000) + delta;
    const fresh = await this.redis.set(`totp_used:${userId}:${step}`, '1', 'EX', 120, 'NX');
    return fresh === 'OK';
  }
}
