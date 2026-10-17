import { Inject, Injectable } from '@nestjs/common';
import {
  areaForRole,
  type InvitationCreateInput,
  type OrganizationCreateInput,
} from '@mesa/shared';
import { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { AuthenticatedUser } from '../common/request-context';
import { MailService } from '../mail/mail.service';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../security/session.service';
import { newToken, sha256Hex } from '../security/tokens';

interface Page {
  cursor?: string;
  limit: number;
}

function pageArgs(p: Page) {
  return { take: p.limit + 1, ...(p.cursor ? { skip: 1, cursor: { id: p.cursor } } : {}) };
}

function toPage<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async listOrganizations(actor: AuthenticatedUser, p: Page) {
    if (p.cursor && !/^[0-9a-f-]{36}$/.test(p.cursor)) throw new AppError('validation_failed');
    const rows = await this.prisma.organization.findMany({
      where: this.policy.organizationScope(actor),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        domains: true,
        isInternal: true,
        mfaRequiredForCustomers: true,
        active: true,
        createdAt: true,
      },
      ...pageArgs(p),
    });
    return toPage(rows, p.limit);
  }

  async createOrganization(req: FastifyRequest, input: OrganizationCreateInput) {
    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({ data: { ...input, isInternal: false } });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'admin.organization.created',
          targetType: 'organization',
          targetId: created.id,
          organizationId: created.id,
          data: { name: created.name },
        },
        tx,
      );
      return created;
    });
    return {
      id: org.id,
      name: org.name,
      domains: org.domains,
      isInternal: org.isInternal,
      mfaRequiredForCustomers: org.mfaRequiredForCustomers,
      active: org.active,
    };
  }

  async listUsers(actor: AuthenticatedUser, q: Page & { organizationId?: string }) {
    if (q.cursor && !/^[0-9a-f-]{36}$/.test(q.cursor)) throw new AppError('validation_failed');
    const where: Prisma.UserWhereInput = {
      AND: [
        this.policy.userScope(actor),
        q.organizationId ? { organizationId: q.organizationId } : {},
      ],
    };
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { id: 'asc' },
      // Explicit allow-list: never select password, TOTP secret or similar.
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        organizationId: true,
        totpEnabledAt: true,
        lastLoginAt: true,
        createdAt: true,
      },
      ...pageArgs(q),
    });
    const page = toPage(rows, q.limit);
    return {
      nextCursor: page.nextCursor,
      items: page.items.map(({ totpEnabledAt, ...u }) => ({
        ...u,
        mfaEnabled: totpEnabledAt !== null,
      })),
    };
  }

  async createInvitation(req: FastifyRequest, input: InvitationCreateInput) {
    const actor = req.auth!.user;
    const org = await this.prisma.organization.findFirst({
      where: {
        AND: [{ id: input.organizationId, active: true }, this.policy.organizationScope(actor)],
      },
    });
    // Unknown and out-of-scope organizations look the same (no IDOR oracle).
    if (!org) throw new AppError('not_found');
    if (!this.policy.canInvite(actor, input.role, org)) throw new AppError('forbidden');
    if (await this.prisma.user.findUnique({ where: { email: input.email } })) {
      throw new AppError('conflict', 'A user with this email already exists.');
    }
    const token = newToken();
    const expiresAt = new Date(Date.now() + this.config.INVITATION_TTL_HOURS * 3_600_000);
    const inv = await this.prisma.$transaction(async (tx) => {
      // A new invitation supersedes pending ones for the same email.
      await tx.invitation.updateMany({
        where: { email: input.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const created = await tx.invitation.create({
        data: {
          tokenHash: sha256Hex(token),
          email: input.email,
          name: input.name,
          role: input.role,
          organizationId: org.id,
          invitedById: actor.id,
          expiresAt,
        },
      });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'admin.invitation.created',
          targetType: 'invitation',
          targetId: created.id,
          organizationId: org.id,
          data: { role: input.role, email: input.email },
        },
        tx,
      );
      return created;
    });
    await this.mail.send({
      template: 'invitation',
      to: input.email,
      locale: 'es-MX',
      params: {
        name: input.name,
        inviterName: actor.name,
        organizationName: org.name,
        link: this.mail.link(areaForRole(input.role), '/invitacion', token),
        expiresHours: this.config.INVITATION_TTL_HOURS,
      },
    });
    return {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      organizationId: inv.organizationId,
      expiresAt: inv.expiresAt,
    };
  }

  async revokeInvitation(req: FastifyRequest, id: string) {
    const actor = req.auth!.user;
    const inv = await this.prisma.invitation.findUnique({
      where: { id },
      include: { organization: true },
    });
    if (!inv) throw new AppError('not_found');
    const inScope = await this.prisma.organization.count({
      where: { AND: [{ id: inv.organizationId }, this.policy.organizationScope(actor)] },
    });
    if (!inScope) throw new AppError('not_found');
    if (!this.policy.canInvite(actor, inv.role, inv.organization)) throw new AppError('forbidden');
    if (inv.acceptedAt || inv.revokedAt)
      throw new AppError('conflict', 'Invitation is no longer pending.');
    await this.prisma.$transaction(async (tx) => {
      await tx.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'admin.invitation.revoked',
          targetType: 'invitation',
          targetId: id,
          organizationId: inv.organizationId,
        },
        tx,
      );
    });
  }

  async revokeUserSessions(req: FastifyRequest, userId: string): Promise<number> {
    const target = await this.prisma.user.findFirst({
      where: { AND: [{ id: userId }, this.policy.userScope(req.auth!.user)] },
    });
    if (!target) throw new AppError('not_found');
    const n = await this.sessions.destroyAll(target.id);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'admin.user.sessions_revoked',
      targetType: 'user',
      targetId: target.id,
      organizationId: target.organizationId,
      data: { count: n },
    });
    return n;
  }

  async listAuditLogs(q: Page & { action?: string; actorUserId?: string }) {
    let cursor: bigint | undefined;
    if (q.cursor) {
      if (!/^\d{1,19}$/.test(q.cursor)) throw new AppError('validation_failed');
      cursor = BigInt(q.cursor);
    }
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(q.action ? { action: q.action } : {}),
        ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
        ...(cursor !== undefined ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const items = (hasMore ? rows.slice(0, q.limit) : rows).map((r) => ({
      ...r,
      id: r.id.toString(),
    }));
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
  }
}
