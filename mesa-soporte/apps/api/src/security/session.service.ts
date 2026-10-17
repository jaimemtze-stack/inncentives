import { Inject, Injectable } from '@nestjs/common';
import type { AuthState, HostArea } from '@mesa/shared';
import type Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/config';
import { REDIS } from '../redis/redis.module';
import { newToken, sha256Hex } from './tokens';

export interface SessionRecord {
  userId: string;
  area: HostArea;
  state: AuthState;
  csrfToken: string;
  createdAt: number;
  absoluteExpiresAt: number;
  lastSeenAt: number;
  reauthAt: number | null;
  mfaFailures: number;
  ip: string | null;
  userAgent: string | null;
}

export interface CreatedSession {
  /** Raw value for the cookie. Never stored. */
  token: string;
  /** Public id (SHA-256 of the token). */
  id: string;
  record: SessionRecord;
}

const TOUCH_INTERVAL_MS = 60_000;

/**
 * Server-side sessions in Redis. The cookie holds a random 256-bit token;
 * Redis only stores its SHA-256, so a Redis dump cannot be replayed as cookies.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private key(id: string): string {
    return `sess:${id}`;
  }

  private userKey(userId: string): string {
    return `usess:${userId}`;
  }

  private idleSeconds(): number {
    return this.config.SESSION_IDLE_MINUTES * 60;
  }

  async create(input: {
    userId: string;
    area: HostArea;
    state: AuthState;
    ip: string | null;
    userAgent: string | null;
    createdAt?: number;
    absoluteExpiresAt?: number;
    reauthAt?: number | null;
  }): Promise<CreatedSession> {
    const now = Date.now();
    const token = newToken();
    const id = sha256Hex(token);
    const record: SessionRecord = {
      userId: input.userId,
      area: input.area,
      state: input.state,
      csrfToken: newToken(),
      createdAt: input.createdAt ?? now,
      absoluteExpiresAt:
        input.absoluteExpiresAt ?? now + this.config.SESSION_ABSOLUTE_HOURS * 3_600_000,
      lastSeenAt: now,
      reauthAt: input.reauthAt ?? null,
      mfaFailures: 0,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
    };
    await this.redis
      .multi()
      .set(this.key(id), JSON.stringify(record), 'EX', this.ttlFor(record, now))
      .sadd(this.userKey(input.userId), id)
      .expire(this.userKey(input.userId), this.config.SESSION_ABSOLUTE_HOURS * 3600 + 60)
      .exec();
    return { token, id, record };
  }

  private ttlFor(record: SessionRecord, now: number): number {
    const untilAbsolute = Math.ceil((record.absoluteExpiresAt - now) / 1000);
    return Math.max(1, Math.min(this.idleSeconds(), untilAbsolute));
  }

  /** Resolve a cookie token. Expired or unknown sessions return null. */
  async resolve(token: string | undefined): Promise<{ id: string; record: SessionRecord } | null> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const id = sha256Hex(token);
    const raw = await this.redis.get(this.key(id));
    if (!raw) return null;
    const record = JSON.parse(raw) as SessionRecord;
    const now = Date.now();
    if (now >= record.absoluteExpiresAt) {
      await this.destroy(id, record.userId);
      return null;
    }
    if (now - record.lastSeenAt > TOUCH_INTERVAL_MS) {
      record.lastSeenAt = now;
      await this.redis.set(this.key(id), JSON.stringify(record), 'EX', this.ttlFor(record, now));
    }
    return { id, record };
  }

  async update(id: string, record: SessionRecord): Promise<void> {
    const now = Date.now();
    await this.redis.set(
      this.key(id),
      JSON.stringify(record),
      'EX',
      this.ttlFor(record, now),
      'XX',
    );
  }

  /**
   * Issue a new session id carrying the same data (plus changes) and delete
   * the old one. Used on privilege changes (MFA completed, password changed).
   */
  async rotate(
    id: string,
    record: SessionRecord,
    changes: Partial<SessionRecord>,
  ): Promise<CreatedSession> {
    const next = await this.create({
      userId: record.userId,
      area: record.area,
      state: changes.state ?? record.state,
      ip: changes.ip ?? record.ip,
      userAgent: changes.userAgent ?? record.userAgent,
      createdAt: record.createdAt,
      absoluteExpiresAt: record.absoluteExpiresAt,
      reauthAt: changes.reauthAt !== undefined ? changes.reauthAt : record.reauthAt,
    });
    await this.destroy(id, record.userId);
    return next;
  }

  async destroy(id: string, userId: string): Promise<void> {
    await this.redis.multi().del(this.key(id)).srem(this.userKey(userId), id).exec();
  }

  async list(userId: string): Promise<{ id: string; record: SessionRecord }[]> {
    const ids = await this.redis.smembers(this.userKey(userId));
    if (ids.length === 0) return [];
    const values = await this.redis.mget(ids.map((id) => this.key(id)));
    const out: { id: string; record: SessionRecord }[] = [];
    const stale: string[] = [];
    ids.forEach((id, i) => {
      const v = values[i];
      if (v) out.push({ id, record: JSON.parse(v) as SessionRecord });
      else stale.push(id);
    });
    if (stale.length) await this.redis.srem(this.userKey(userId), ...stale);
    return out.sort((a, b) => b.record.lastSeenAt - a.record.lastSeenAt);
  }

  /** Returns true only if the session exists and belongs to the user. */
  async destroyOwned(userId: string, id: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(id)) return false;
    const isMember = await this.redis.sismember(this.userKey(userId), id);
    if (!isMember) return false;
    await this.destroy(id, userId);
    return true;
  }

  async destroyAll(userId: string, exceptId?: string): Promise<number> {
    const ids = await this.redis.smembers(this.userKey(userId));
    const targets = ids.filter((id) => id !== exceptId);
    if (targets.length === 0) return 0;
    const multi = this.redis.multi();
    for (const id of targets) multi.del(this.key(id)).srem(this.userKey(userId), id);
    await multi.exec();
    return targets.length;
  }
}
