import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { AppError } from '../common/errors';
import { REDIS } from '../redis/redis.module';
import { sha256Hex } from './tokens';

type LimiterName =
  | 'loginIp'
  | 'loginAccount'
  | 'loginAccountDaily'
  | 'mfa'
  | 'forgotIp'
  | 'forgotAccount'
  | 'tokenIp'
  | 'reauth';

/**
 * Progressive throttling for authentication endpoints (ASVS 2.2.1). Keys that
 * contain emails are hashed so Redis never holds the address in clear text.
 */
@Injectable()
export class RateLimitService {
  private readonly limiters: Record<LimiterName, RateLimiterRedis>;

  constructor(@Inject(REDIS) redis: Redis) {
    const make = (keyPrefix: string, points: number, duration: number, blockDuration = 0) =>
      new RateLimiterRedis({
        storeClient: redis,
        keyPrefix: `rl:${keyPrefix}`,
        points,
        duration,
        blockDuration,
      });
    this.limiters = {
      loginIp: make('login_ip', 30, 15 * 60, 15 * 60),
      loginAccount: make('login_acct', 5, 15 * 60, 15 * 60),
      loginAccountDaily: make('login_acct_d', 20, 24 * 3600, 24 * 3600),
      mfa: make('mfa', 5, 15 * 60, 15 * 60),
      forgotIp: make('forgot_ip', 10, 3600),
      forgotAccount: make('forgot_acct', 3, 3600),
      tokenIp: make('token_ip', 30, 3600),
      reauth: make('reauth', 5, 15 * 60, 15 * 60),
    };
  }

  static accountKey(email: string): string {
    return sha256Hex(email.toLowerCase());
  }

  /** Throws rate_limited if the key is currently blocked, without consuming. */
  async assertNotBlocked(name: LimiterName, key: string): Promise<void> {
    const res = await this.limiters[name].get(key);
    if (res && res.consumedPoints >= this.limiters[name].points) {
      throw new AppError(
        'rate_limited',
        undefined,
        undefined,
        429,
        Math.ceil(res.msBeforeNext / 1000),
      );
    }
  }

  /** Consumes one point; throws rate_limited once the budget is exhausted. */
  async consume(name: LimiterName, key: string): Promise<void> {
    try {
      await this.limiters[name].consume(key);
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        throw new AppError(
          'rate_limited',
          undefined,
          undefined,
          429,
          Math.ceil(err.msBeforeNext / 1000),
        );
      }
      throw err;
    }
  }

  /** Consume without throwing (used to record a failure after responding). */
  async penalize(name: LimiterName, key: string): Promise<void> {
    await this.limiters[name].penalty(key, 1);
  }

  async reset(name: LimiterName, key: string): Promise<void> {
    await this.limiters[name].delete(key);
  }
}
