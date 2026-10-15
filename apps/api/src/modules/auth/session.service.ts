import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { randomToken, sha256 } from '../../common/crypto/tokens';
import { RedisService } from '../../common/redis/redis.service';
import type { Area, SessionInfo } from '../../common/auth/actor';

export interface NewSession {
  userId: string;
  area: Area;
  mfaPending: boolean;
  mfaSetupRequired: boolean;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Server-side sessions in Redis (ADR-0006). The cookie holds a 256-bit random id; Redis only
 * stores its SHA-256, so a Redis dump does not yield usable session ids.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get idleMs() {
    return this.config.SESSION_IDLE_MINUTES * 60_000;
  }
  private get absoluteMs() {
    return this.config.SESSION_ABSOLUTE_HOURS * 3_600_000;
  }
  private key(hash: string) {
    return `sess:${hash}`;
  }
  private userKey(userId: string) {
    return `usess:${userId}`;
  }

  async create(s: NewSession, now = Date.now()): Promise<{ id: string; info: SessionInfo }> {
    const id = randomToken(32);
    const info: SessionInfo = {
      hash: sha256(id),
      userId: s.userId,
      area: s.area,
      createdAt: now,
      lastSeenAt: now,
      mfaPending: s.mfaPending,
      mfaSetupRequired: s.mfaSetupRequired,
      reauthAt: null,
      ip: s.ip,
      userAgent: s.userAgent?.slice(0, 300) ?? null,
    };
    await this.save(info, now);
    await this.redis.sadd(this.userKey(s.userId), info.hash);
    return { id, info };
  }

  private async save(info: SessionInfo, now: number) {
    const ttl = Math.min(this.idleMs, info.createdAt + this.absoluteMs - now);
    if (ttl <= 0) {
      await this.destroyByHash(info.hash, info.userId);
      return;
    }
    await this.redis.set(this.key(info.hash), JSON.stringify(info), 'PX', ttl);
  }

  /** Loads and touches a session; returns null if missing, idle-expired or past absolute lifetime. */
  async load(id: string, now = Date.now()): Promise<SessionInfo | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    const hash = sha256(id);
    const raw = await this.redis.get(this.key(hash));
    if (!raw) return null;
    const info = JSON.parse(raw) as SessionInfo;
    if (now - info.lastSeenAt > this.idleMs || now - info.createdAt > this.absoluteMs) {
      await this.destroyByHash(hash, info.userId);
      return null;
    }
    info.lastSeenAt = now;
    await this.save(info, now);
    return info;
  }

  /** Issues a new id for the same session (fixation protection). */
  async rotate(
    info: SessionInfo,
    changes: Partial<SessionInfo> = {},
    now = Date.now(),
  ): Promise<{ id: string; info: SessionInfo }> {
    await this.destroyByHash(info.hash, info.userId);
    const id = randomToken(32);
    const next: SessionInfo = { ...info, ...changes, hash: sha256(id), lastSeenAt: now };
    await this.save(next, now);
    await this.redis.sadd(this.userKey(info.userId), next.hash);
    return { id, info: next };
  }

  async update(
    info: SessionInfo,
    changes: Partial<SessionInfo>,
    now = Date.now(),
  ): Promise<SessionInfo> {
    const next = { ...info, ...changes };
    await this.save(next, now);
    return next;
  }

  async destroyByHash(hash: string, userId: string): Promise<void> {
    await this.redis.multi().del(this.key(hash)).srem(this.userKey(userId), hash).exec();
  }

  async list(userId: string): Promise<SessionInfo[]> {
    const hashes = await this.redis.smembers(this.userKey(userId));
    if (!hashes.length) return [];
    const raws = await this.redis.mget(hashes.map((h) => this.key(h)));
    const alive: SessionInfo[] = [];
    const dead: string[] = [];
    raws.forEach((r, i) => (r ? alive.push(JSON.parse(r) as SessionInfo) : dead.push(hashes[i]!)));
    if (dead.length) await this.redis.srem(this.userKey(userId), ...dead);
    return alive.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  /** Public, non-secret identifier of a session for listing/revocation. */
  publicId(info: SessionInfo): string {
    return info.hash.slice(0, 16);
  }

  async revokeByPublicId(userId: string, publicId: string): Promise<boolean> {
    const s = (await this.list(userId)).find((x) => this.publicId(x) === publicId);
    if (!s) return false;
    await this.destroyByHash(s.hash, userId);
    return true;
  }

  async revokeAll(userId: string, exceptHash?: string): Promise<number> {
    const sessions = await this.list(userId);
    let n = 0;
    for (const s of sessions) {
      if (s.hash === exceptHash) continue;
      await this.destroyByHash(s.hash, userId);
      n++;
    }
    return n;
  }
}
