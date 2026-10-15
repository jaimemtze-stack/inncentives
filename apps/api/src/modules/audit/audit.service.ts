import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { sha256 } from '../../common/crypto/tokens';
import { PrismaService } from '../../common/prisma/prisma.service';

export type AuditAction =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.login.locked'
  | 'auth.logout'
  | 'auth.mfa.success'
  | 'auth.mfa.failure'
  | 'auth.mfa.enabled'
  | 'auth.mfa.disabled'
  | 'auth.reauth'
  | 'auth.password.changed'
  | 'auth.password.reset_requested'
  | 'auth.password.reset'
  | 'auth.session.revoked'
  | 'user.invited'
  | 'user.invitation.accepted'
  | 'user.roles.changed'
  | 'api_token.created'
  | 'api_token.revoked'
  | 'admin.view_as_customer'
  | 'data.export'
  | 'attachment.download'
  | 'content.redacted'
  | 'user.anonymized'
  | 'settings.security.changed'
  | 'integration.changed';

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  actorType?: 'user' | 'system' | 'api_token' | 'anonymous';
  objectType?: string;
  objectId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

const GENESIS = '0'.repeat(64);
const AUDIT_LOCK_KEY = 0x1a0d17; // advisory lock serializing the hash chain
const SECRET_KEYS = /pass|secret|token|code|hash|key|cookie/i;

/** Removes secret-looking keys from before/after snapshots. */
export function scrub(
  obj: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!obj) return null;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      SECRET_KEYS.test(k)
        ? '[REDACTED]'
        : v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
          ? scrub(v as Record<string, unknown>)
          : v,
    ]),
  );
}

interface HashInput {
  occurredAt: Date;
  actorId: string | null;
  actorType: string;
  action: string;
  objectType: string | null;
  objectId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
  prevHash: string;
}

function canonical(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export function computeAuditHash(e: HashInput): string {
  return sha256(canonical(e));
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
      const last = await tx.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });
      const data: HashInput = {
        occurredAt: new Date(),
        actorId: entry.actorId ?? null,
        actorType: entry.actorType ?? (entry.actorId ? 'user' : 'anonymous'),
        action: entry.action,
        objectType: entry.objectType ?? null,
        objectId: entry.objectId ?? null,
        before: scrub(entry.before),
        after: scrub(entry.after),
        ip: entry.ip ?? null,
        userAgent: entry.userAgent?.slice(0, 512) ?? null,
        correlationId: entry.correlationId ?? null,
        prevHash: last?.hash ?? GENESIS,
      };
      await tx.auditLog.create({
        data: {
          ...data,
          before: (data.before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          after: (data.after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          hash: computeAuditHash(data),
        },
      });
    });
  }

  /** Recomputes the chain. Returns the id of the first broken record, or null if intact. */
  async verifyChain(
    batchSize = 1000,
  ): Promise<{ ok: boolean; brokenAt: string | null; checked: number }> {
    let prev = GENESIS;
    let cursor: bigint | undefined;
    let checked = 0;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({
        take: batchSize,
        ...(cursor !== undefined ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });
      if (rows.length === 0) return { ok: true, brokenAt: null, checked };
      for (const r of rows) {
        const expected = computeAuditHash({
          occurredAt: r.occurredAt,
          actorId: r.actorId,
          actorType: r.actorType,
          action: r.action,
          objectType: r.objectType,
          objectId: r.objectId,
          before: r.before,
          after: r.after,
          ip: r.ip,
          userAgent: r.userAgent,
          correlationId: r.correlationId,
          prevHash: r.prevHash,
        });
        if (r.prevHash !== prev || r.hash !== expected)
          return { ok: false, brokenAt: r.id.toString(), checked };
        prev = r.hash;
        checked++;
      }
      cursor = rows[rows.length - 1]!.id;
    }
  }
}
