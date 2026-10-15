import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hasPermission, type InviteUserInput } from '@inn/shared';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import type { Actor } from '../../common/auth/actor';
import { MAIL_QUEUE, type MailQueue } from '../../common/mail/mail-queue';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OneTimeTokenService } from '../auth/one-time-token.service';
import { SessionService } from '../auth/session.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: OneTimeTokenService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(MAIL_QUEUE) private readonly mail: MailQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Invitation-only provisioning (no self-registration). Admins may invite any role;
   * agents may only invite customers into an existing organization.
   */
  async invite(actor: Actor, input: InviteUserInput, meta: { ip: string; correlationId: string }) {
    const isAdmin = hasPermission(actor.permissions, 'admin.user');
    if (!isAdmin && input.roles.some((r) => r !== 'customer')) throw new ForbiddenException();
    if (input.roles.includes('customer') && !input.organizationId) {
      throw new BadRequestException('organization_required');
    }
    if (input.organizationId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: input.organizationId },
      });
      if (!org || !org.active) throw new BadRequestException('organization_invalid');
    }
    const roles = await this.prisma.role.findMany({ where: { name: { in: input.roles } } });
    if (roles.length !== input.roles.length) throw new BadRequestException('role_invalid');

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing && existing.status !== 'invited') throw new ConflictException('user_exists');

    const user =
      existing ??
      (await this.prisma.user.create({
        data: {
          email: input.email,
          firstname: input.firstname,
          lastname: input.lastname,
          locale: input.locale,
          status: 'invited',
          organizationId: input.organizationId ?? null,
          sharedOrganization: input.sharedOrganization,
          roles: { create: roles.map((r) => ({ roleId: r.id })) },
        },
      }));

    const token = await this.tokens.issue(
      user.id,
      'invitation',
      this.config.INVITATION_TTL_HOURS * 3_600_000,
    );
    const isCustomerOnly = input.roles.every((r) => r === 'customer');
    const base = isCustomerOnly ? this.config.PORTAL_URL : this.config.AGENT_URL;
    await this.mail.enqueue({
      template: 'invitation',
      to: user.email,
      locale: user.locale,
      vars: {
        link: `${base}/accept-invitation#token=${token}`,
        firstname: user.firstname,
        hours: String(this.config.INVITATION_TTL_HOURS),
      },
    });
    await this.audit.record({
      action: 'user.invited',
      actorId: actor.userId,
      objectType: 'User',
      objectId: user.id,
      after: { roles: input.roles, organizationId: input.organizationId ?? null },
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return { id: user.id, email: user.email, status: user.status };
  }

  async revokeSessions(actor: Actor, userId: string, meta: { ip: string; correlationId: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException();
    const count = await this.sessions.revokeAll(userId);
    await this.audit.record({
      action: 'auth.session.revoked',
      actorId: actor.userId,
      objectType: 'User',
      objectId: userId,
      after: { count },
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return { revoked: count };
  }
}
