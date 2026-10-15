import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService, scrub } from '../src/modules/audit/audit.service';
import { createTestContext, resetDatabase, type TestContext } from './helpers';

describe('AuditService (append-only, hash chain)', () => {
  let ctx: TestContext;
  let audit: AuditService;
  beforeAll(async () => {
    ctx = await createTestContext();
    audit = ctx.app.get(AuditService);
  });
  beforeEach(() => resetDatabase(ctx));
  afterAll(() => ctx.close());

  it('chains records and verifies them', async () => {
    await audit.record({ action: 'auth.login.success', actorId: null, ip: '1.1.1.1' });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        audit.record({ action: 'auth.login.failure', after: { i } }),
      ),
    );
    const rows = await ctx.prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(11);
    expect(rows[0]!.prevHash).toBe('0'.repeat(64));
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.prevHash).toBe(rows[i - 1]!.hash);
    expect(await audit.verifyChain(4)).toEqual({ ok: true, brokenAt: null, checked: 11 });
  });

  it('rejects UPDATE, DELETE and TRUNCATE at the database level', async () => {
    await audit.record({ action: 'auth.logout' });
    await expect(ctx.prisma.auditLog.updateMany({ data: { action: 'x' } })).rejects.toThrow(
      /append-only/,
    );
    await expect(ctx.prisma.auditLog.deleteMany()).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRaw`TRUNCATE audit_logs`).rejects.toThrow(/append-only/);
  });

  it('detects tampering (simulated with triggers disabled by a superuser)', async () => {
    await audit.record({ action: 'auth.login.success' });
    await audit.record({ action: 'user.invited', after: { roles: ['agent'] } });
    await audit.record({ action: 'auth.logout' });
    await ctx.prisma.$transaction([
      ctx.prisma.$executeRaw`SET LOCAL session_replication_role = replica`,
      ctx.prisma
        .$executeRaw`UPDATE audit_logs SET after = '{"roles":["admin"]}' WHERE action = 'user.invited'`,
    ]);
    const res = await audit.verifyChain();
    expect(res.ok).toBe(false);
    expect(res.brokenAt).toBe('2');
  });

  it('scrubs secrets from snapshots', () => {
    expect(scrub({ password: 'x', nested: { apiToken: 'y', name: 'ok' }, list: [1] })).toEqual({
      password: '[REDACTED]',
      nested: { apiToken: '[REDACTED]', name: 'ok' },
      list: [1],
    });
    expect(scrub(null)).toBeNull();
  });
});
