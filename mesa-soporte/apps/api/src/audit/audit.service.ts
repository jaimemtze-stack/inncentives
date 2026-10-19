import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';

export const GENESIS_HASH = '0'.repeat(64);
// Arbitrary constant: serialises inserts so the hash chain has no forks.
const AUDIT_LOCK_KEY = 815_201_7;

export interface AuditEvent {
  action: string;
  actorType: 'user' | 'anonymous' | 'system';
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  organizationId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  data?: Record<string, unknown> | null;
}

const SENSITIVE_KEY = /pass(word)?|token|secret|code|otp|cookie|authorization/i;

/** Recursively drops values whose key looks sensitive. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v),
      ]),
    );
  }
  return value;
}

/** Deterministic JSON (sorted keys) so the hash is reproducible. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

interface HashableRow {
  occurredAt: Date;
  actorType: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  organizationId: string | null;
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
  data: unknown;
}

export function computeHash(prevHash: string, row: HashableRow): string {
  const payload = canonicalJson({
    occurredAt: row.occurredAt.toISOString(),
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    organizationId: row.organizationId,
    ip: row.ip,
    userAgent: row.userAgent,
    correlationId: row.correlationId,
    data: row.data ?? null,
  });
  return createHash('sha256').update(prevHash).update('\n').update(payload).digest('hex');
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Request-derived fields for an event (actor, ip, user agent, correlation). */
  static fromRequest(
    req: FastifyRequest,
  ): Pick<AuditEvent, 'actorType' | 'actorUserId' | 'ip' | 'userAgent' | 'correlationId'> {
    const ua = req.headers['user-agent'];
    return {
      actorType: req.auth ? 'user' : 'anonymous',
      actorUserId: req.auth?.user.id ?? null,
      ip: req.clientIp ?? null,
      userAgent: typeof ua === 'string' ? ua.slice(0, 400) : null,
      correlationId: req.correlationId ?? null,
    };
  }

  async record(event: AuditEvent, tx?: Prisma.TransactionClient): Promise<void> {
    const write = async (db: Prisma.TransactionClient) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
      const last = await db.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });
      const prevHash = last?.hash ?? GENESIS_HASH;
      // Millisecond precision matches the column, so the stored row re-hashes identically.
      const occurredAt = new Date(Math.floor(Date.now()));
      const row: HashableRow = {
        occurredAt,
        actorType: event.actorType,
        actorUserId: event.actorUserId ?? null,
        action: event.action,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        organizationId: event.organizationId ?? null,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
        correlationId: event.correlationId ?? null,
        data: event.data ? redact(event.data) : null,
      };
      await db.auditLog.create({
        data: {
          ...row,
          data: row.data === null ? Prisma.JsonNull : (row.data as Prisma.InputJsonValue),
          prevHash,
          hash: computeHash(prevHash, row),
        },
      });
    };
    if (tx) await write(tx);
    else await this.prisma.$transaction(write);
  }

  /** Recomputes the whole chain. Returns the first broken id, if any. */
  async verifyChain(): Promise<{ ok: boolean; checked: number; brokenAtId?: string }> {
    let prev = GENESIS_HASH;
    let cursor: bigint | undefined;
    let checked = 0;
    for (;;) {
      const batch = await this.prisma.auditLog.findMany({
        where: cursor === undefined ? undefined : { id: { gt: cursor } },
        orderBy: { id: 'asc' },
        take: 500,
      });
      if (batch.length === 0) return { ok: true, checked };
      for (const r of batch) {
        const expected = computeHash(prev, { ...r, data: r.data ?? null });
        if (r.prevHash !== prev || r.hash !== expected) {
          return { ok: false, checked, brokenAtId: r.id.toString() };
        }
        prev = r.hash;
        checked++;
      }
      cursor = batch[batch.length - 1]?.id;
    }
  }
}
