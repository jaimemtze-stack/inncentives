import { Injectable } from '@nestjs/common';
import { sha256 } from '../../common/crypto/tokens';
import { RedisService } from '../../common/redis/redis.service';

export interface ThrottlePolicy {
  windowSeconds: number;
  /** Failures per account before progressive delays start. */
  delayAfter: number;
  /** Failures per account that lock it temporarily. */
  lockAfter: number;
  lockSeconds: number;
  /** Attempts per IP per window across all accounts. */
  ipLimit: number;
  maxDelayMs: number;
}

export const DEFAULT_THROTTLE: ThrottlePolicy = {
  windowSeconds: 15 * 60,
  delayAfter: 5,
  lockAfter: 10,
  lockSeconds: 15 * 60,
  ipLimit: 100,
  maxDelayMs: 4000,
};

export type ThrottleDecision =
  { allowed: true; delayMs: number } | { allowed: false; retryAfterSeconds: number };

/**
 * Progressive lockout per account and per IP (ASVS V2.2.1). Keys are hashed so Redis never
 * stores e-mail addresses. Scope separates login / mfa / reset / invitation counters.
 */
@Injectable()
export class LoginThrottleService {
  policy: ThrottlePolicy = DEFAULT_THROTTLE;

  constructor(private readonly redis: RedisService) {}

  private key(scope: string, kind: 'acct' | 'ip' | 'lock', id: string) {
    return `thr:${scope}:${kind}:${sha256(id.toLowerCase())}`;
  }

  async check(scope: string, account: string, ip: string): Promise<ThrottleDecision> {
    const [lockTtl, acct, ipCount] = await Promise.all([
      this.redis.ttl(this.key(scope, 'lock', account)),
      this.redis.get(this.key(scope, 'acct', account)),
      this.redis.get(this.key(scope, 'ip', ip)),
    ]);
    if (lockTtl > 0) return { allowed: false, retryAfterSeconds: lockTtl };
    if (Number(ipCount ?? 0) >= this.policy.ipLimit) {
      const ttl = await this.redis.ttl(this.key(scope, 'ip', ip));
      return { allowed: false, retryAfterSeconds: Math.max(ttl, 1) };
    }
    const failures = Number(acct ?? 0);
    const over = failures - this.policy.delayAfter;
    const delayMs = over >= 0 ? Math.min(250 * 2 ** over, this.policy.maxDelayMs) : 0;
    return { allowed: true, delayMs };
  }

  /** Records a failure; returns true if the account just got locked. */
  async fail(scope: string, account: string, ip: string): Promise<boolean> {
    const acctKey = this.key(scope, 'acct', account);
    const ipKey = this.key(scope, 'ip', ip);
    const res = await this.redis
      .multi()
      .incr(acctKey)
      .expire(acctKey, this.policy.windowSeconds, 'NX')
      .incr(ipKey)
      .expire(ipKey, this.policy.windowSeconds, 'NX')
      .exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    if (count >= this.policy.lockAfter) {
      await this.redis.set(this.key(scope, 'lock', account), '1', 'EX', this.policy.lockSeconds);
      await this.redis.del(acctKey);
      return true;
    }
    return false;
  }

  async succeed(scope: string, account: string): Promise<void> {
    await this.redis.del(this.key(scope, 'acct', account));
  }
}
