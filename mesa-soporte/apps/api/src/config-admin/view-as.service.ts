import { Inject, Injectable } from '@nestjs/common';
import { effectivePermissions } from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { AuthenticatedUser } from '../common/request-context';
import { OverviewsService } from '../overviews/overviews.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { newToken, sha256Hex } from '../security/tokens';
import { TicketExtrasService } from '../tickets/ticket-extras.service';

const TTL_SECONDS = 15 * 60;

interface ViewAsRecord {
  adminId: string;
  customerId: string;
  expiresAt: number;
}

/**
 * "View as customer": administrators see the portal data of one customer,
 * read-only (only GET endpoints exist), for 15 minutes, with a reason that
 * goes to the audit log. Every read is checked against the customer's own
 * ticket policy.
 */
@Injectable()
export class ViewAsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly overviews: OverviewsService,
    private readonly extras: TicketExtrasService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async start(req: FastifyRequest, userId: string, reason: string) {
    const customer = await this.prisma.user.findFirst({ where: { id: userId, role: 'CUSTOMER' } });
    if (!customer) throw new AppError('not_found');
    const sid = newToken();
    const record: ViewAsRecord = {
      adminId: req.auth!.user.id,
      customerId: customer.id,
      expiresAt: Date.now() + TTL_SECONDS * 1000,
    };
    await this.redis.set(`viewas:${sha256Hex(sid)}`, JSON.stringify(record), 'EX', TTL_SECONDS);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'admin.view_as.started',
      targetType: 'user',
      targetId: customer.id,
      organizationId: customer.organizationId,
      data: { reason },
    });
    return {
      sid,
      expiresAt: new Date(record.expiresAt),
      customer: { id: customer.id, name: customer.name, email: customer.email },
    };
  }

  private async customer(req: FastifyRequest, sid: string): Promise<AuthenticatedUser> {
    const raw = await this.redis.get(`viewas:${sha256Hex(sid)}`);
    const rec = raw ? (JSON.parse(raw) as ViewAsRecord) : null;
    if (!rec || rec.adminId !== req.auth!.user.id || rec.expiresAt < Date.now())
      throw new AppError('not_found');
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: rec.customerId } });
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      organizationId: u.organizationId,
      locale: u.locale,
      mfaEnabled: u.totpEnabledAt !== null,
      permissions: effectivePermissions(u.role),
    };
  }

  async tickets(req: FastifyRequest, sid: string, overview?: string) {
    const c = await this.customer(req, sid);
    return this.overviews.tickets(c, {
      overview: overview && /^[a-z0-9-]{1,60}$/.test(overview) ? overview : undefined,
      limit: 50,
    });
  }

  async ticket(req: FastifyRequest, sid: string, id: string) {
    const c = await this.customer(req, sid);
    return { ticket: await this.extras.get(c, id), articles: await this.extras.articles(c, id) };
  }
}
