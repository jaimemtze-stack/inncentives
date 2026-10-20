import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Permission, UuidParamSchema } from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { normalizePhone } from '../channels/phone/phone';
import { AppError } from '../common/errors';
import { ZodPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { Area, RequirePermissions, RequireReauth } from '../policy/decorators';
import { PrivacyService } from '../privacy/privacy.service';
import { SessionService } from '../security/session.service';
import { SettingsService, type SettingKey } from '../settings/settings.service';
import { ConfigAdminService } from './config-admin.service';
import { GroupAccessSchema } from './resources';
import { ViewAsService } from './view-as.service';

const ResourceParam = z.object({ resource: z.string().regex(/^[a-z-]{1,40}$/) });
const ResourceIdParam = ResourceParam.extend({ id: z.string().uuid() });

const SettingsSchema = z
  .object({
    ticket_hook: z.string().regex(/^[A-Za-z#]{1,20}$/),
    time_accounting: z.object({ enabled: z.boolean(), required: z.boolean() }).strict(),
    customer_can_close: z.boolean(),
    auto_reply_limit_per_hour: z.number().int().min(0).max(100),
    portal_group_id: z.string().uuid(),
    privacy_notice: z.object({ es: z.string().max(4000), en: z.string().max(4000) }).strict(),
    default_locale: z.enum(['es-MX', 'en']),
    sso_providers: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]{1,40}$/),
            label: z.string().trim().min(1).max(80),
            area: z.enum(['agent', 'portal']),
            issuer: z.string().url().max(300),
            clientId: z.string().min(1).max(200),
            secretName: z.string().regex(/^[a-z0-9_]{1,60}$/),
            scopes: z
              .string()
              .regex(/^[\w:./ -]{1,300}$/)
              .default('openid profile email'),
            trustIdpMfa: z.boolean().default(false),
          })
          .strict(),
      )
      .max(5),
    azure_devops: z
      .object({
        organization: z.string().regex(/^([A-Za-z0-9][A-Za-z0-9-]{0,49})?$/),
        project: z
          .string()
          .max(64)
          .regex(/^[^/\\?#%]*$/),
        defaultType: z.enum(['Bug', 'Task', 'User Story', 'Issue']),
        secretName: z.string().regex(/^[a-z0-9_]{1,60}$/),
      })
      .strict(),
    inncentives: z
      .object({
        mode: z.enum(['off', 'mock', 'http']),
        baseUrl: z.union([z.literal(''), z.string().url().max(300).startsWith('https://')]),
        secretName: z.string().regex(/^[a-z0-9_]{1,60}$/),
        widgetSecretName: z.string().regex(/^[a-z0-9_]{1,60}$/),
        widgetIssuer: z.string().min(1).max(200),
      })
      .strict(),
    messaging: z
      .object({
        whatsappApiVersion: z.string().regex(/^v\d{1,2}\.\d$/),
        twilioAccountSid: z.string().regex(/^(AC[0-9a-f]{32})?$/),
        reopenDays: z.number().int().min(0).max(90),
      })
      .strict(),
    chat: z
      .object({
        enabled: z.boolean(),
        groupId: z.string().uuid(),
        idleMinutes: z.number().int().min(2).max(240),
      })
      .strict(),
    ai: z
      .object({
        enabled: z.boolean(),
        model: z.string().regex(/^[a-z0-9.-]{3,80}$/),
        secretName: z.string().regex(/^[a-z0-9_]{1,60}$/),
      })
      .strict(),
    branding: z
      .object({
        productName: z.string().trim().min(1).max(80),
        primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      })
      .strict(),
  })
  .partial()
  .strict();

const UserUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().max(30).nullable().optional(),
    mobile: z.string().max(30).nullable().optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    orgTicketAccess: z.boolean().optional(),
    /** Staff live in the internal organization; customers in a client organization. */
    role: z.enum(['ADMIN', 'AGENT', 'CUSTOMER']).optional(),
    organizationId: z.string().uuid().optional(),
    secondaryOrganizationIds: z.array(z.string().uuid()).max(20).optional(),
    customRoleIds: z.array(z.string().uuid()).max(20).optional(),
  })
  .strict();

const OrganizationUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    domains: z.array(z.string().trim().toLowerCase().max(253)).max(20).optional(),
    mfaRequiredForCustomers: z.boolean().optional(),
    supportPlanId: z.string().uuid().nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    active: z.boolean().optional(),
    inncentivesTenantKey: z
      .string()
      .regex(/^[a-z0-9-]{2,63}$/)
      .nullable()
      .optional(),
    aiEnabled: z.boolean().optional(),
  })
  .strict();

const PrivacyTaskSchema = z
  .object({
    userId: z.string().uuid(),
    action: z.enum(['export', 'anonymize', 'delete']),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
const DeliveriesQuery = z.object({ targetId: z.string().uuid().optional() }).strict();
const ViewAsSchema = z
  .object({ userId: z.string().uuid(), reason: z.string().trim().min(5).max(500) })
  .strict();
const ViewAsParam = z.object({ sid: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const ViewAsTicketParam = ViewAsParam.extend({ id: z.string().uuid() });

/** Administration of configuration, users, organizations and privacy tasks. */
@Controller('admin')
@Area('agent')
export class ConfigAdminController {
  constructor(
    private readonly config: ConfigAdminService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly privacy: PrivacyService,
    private readonly viewAs: ViewAsService,
  ) {}

  // ------------------------------------------------------------ config CRUD

  @Get('config/:resource')
  @RequirePermissions(Permission.AdminConfig)
  list(@Param(new ZodPipe(ResourceParam)) p: z.infer<typeof ResourceParam>) {
    return this.config.list(p.resource);
  }

  @Post('config/:resource')
  @RequirePermissions(Permission.AdminConfig)
  create(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(ResourceParam)) p: z.infer<typeof ResourceParam>,
    @Body() body: unknown,
  ) {
    return this.config.create(req, p.resource, body);
  }

  @Patch('config/:resource/:id')
  @RequirePermissions(Permission.AdminConfig)
  update(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(ResourceIdParam)) p: z.infer<typeof ResourceIdParam>,
    @Body() body: unknown,
  ) {
    return this.config.update(req, p.resource, p.id, body);
  }

  @Delete('config/:resource/:id')
  @RequirePermissions(Permission.AdminConfig)
  @HttpCode(204)
  async remove(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(ResourceIdParam)) p: z.infer<typeof ResourceIdParam>,
  ) {
    await this.config.remove(req, p.resource, p.id);
  }

  @Get('settings')
  @RequirePermissions(Permission.AdminConfig)
  getSettings() {
    return this.settings.all();
  }

  @Put('settings')
  @RequirePermissions(Permission.AdminConfig)
  async putSettings(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(SettingsSchema)) body: z.infer<typeof SettingsSchema>,
  ) {
    if (
      body.portal_group_id &&
      !(await this.prisma.group.findFirst({ where: { id: body.portal_group_id, active: true } }))
    ) {
      throw new AppError('validation_failed', 'Unknown group.', [
        { path: 'portal_group_id', code: 'invalid' },
      ]);
    }
    const before = await this.settings.all();
    for (const [k, v] of Object.entries(body)) await this.settings.set(k as SettingKey, v as never);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'config.settings.updated',
      targetType: 'settings',
      data: {
        before: Object.fromEntries(Object.keys(body).map((k) => [k, before[k]])),
        after: body,
      },
    });
    return this.settings.all();
  }

  // ----------------------------------------------------- users & organizations

  @Get('users/:id')
  @RequirePermissions(Permission.UsersRead)
  async user(@Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    const u = await this.prisma.user.findUnique({
      where: { id: p.id },
      include: {
        organization: { select: { id: true, name: true } },
        groupAccess: true,
        customRoles: { select: { roleId: true } },
        secondaryOrganizations: { select: { organizationId: true } },
        _count: { select: { webauthnCredentials: true, recoveryCodes: true } },
      },
    });
    if (!u) throw new AppError('not_found');
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      organization: u.organization,
      phone: u.phone,
      mobile: u.mobile,
      orgTicketAccess: u.orgTicketAccess,
      mfaEnabled: u.totpEnabledAt !== null || u._count.webauthnCredentials > 0,
      mfa: {
        totp: u.totpEnabledAt !== null,
        passkeys: u._count.webauthnCredentials,
        recoveryCodes: u._count.recoveryCodes,
      },
      lastLoginAt: u.lastLoginAt,
      groupAccess: u.groupAccess.map((g) => ({ groupId: g.groupId, levels: g.levels })),
      customRoleIds: u.customRoles.map((c) => c.roleId),
      secondaryOrganizationIds: u.secondaryOrganizations.map((s) => s.organizationId),
    };
  }

  @Patch('users/:id')
  @RequirePermissions(Permission.UsersInviteStaff)
  @RequireReauth()
  async updateUser(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(UserUpdateSchema)) body: z.infer<typeof UserUpdateSchema>,
  ) {
    const target = await this.prisma.user.findUnique({ where: { id: p.id } });
    if (!target) throw new AppError('not_found');
    const self = target.id === req.auth!.user.id;
    if (self && (body.status || body.customRoleIds || body.role || body.organizationId)) {
      throw new AppError(
        'forbidden',
        'You cannot change your own status, role, organization or custom roles.',
      );
    }
    const phone = (v: string | null | undefined) => {
      if (v === undefined || v === null || v === '') return v === '' ? null : v;
      const n = normalizePhone(v);
      if (!n)
        throw new AppError('validation_failed', 'Invalid phone number.', [
          { path: 'phone', code: 'invalid' },
        ]);
      return n;
    };
    const role = body.role ?? target.role;
    const organizationId = body.organizationId ?? target.organizationId;
    const roleChanged = role !== target.role;
    const orgChanged = organizationId !== target.organizationId;
    const toCustomer = role === 'CUSTOMER';
    if (roleChanged || orgChanged) {
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
      if (!org || !org.active)
        throw new AppError('validation_failed', 'Unknown organization.', [
          { path: 'organizationId', code: 'invalid' },
        ]);
      // Same rule as invitations: staff belong to the internal organization, customers never do.
      if (org.isInternal === toCustomer)
        throw new AppError(
          'validation_failed',
          toCustomer
            ? 'Customers must belong to a client organization.'
            : 'Agents and administrators must belong to the internal organization.',
          [{ path: 'organizationId', code: 'invalid' }],
        );
    }
    // Never leave the desk without an active administrator.
    const losesAdmin =
      target.role === 'ADMIN' &&
      target.status === 'ACTIVE' &&
      (role !== 'ADMIN' || body.status === 'DISABLED');
    if (losesAdmin) {
      const others = await this.prisma.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE', id: { not: target.id } },
      });
      if (!others)
        throw new AppError('conflict', 'This is the only active administrator.', [
          { path: 'role', code: 'last_admin' },
        ]);
    }
    if (body.customRoleIds?.length && toCustomer)
      throw new AppError('validation_failed', 'Customers cannot have roles.');
    if (body.secondaryOrganizationIds?.length && !toCustomer)
      throw new AppError('validation_failed', 'Only customers have secondary organizations.');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: p.id },
        data: {
          name: body.name,
          phone: phone(body.phone),
          mobile: phone(body.mobile),
          status: body.status,
          role: roleChanged ? role : undefined,
          organizationId: orgChanged ? organizationId : undefined,
          // Organization-wide ticket access only makes sense for customers.
          orgTicketAccess: toCustomer ? body.orgTicketAccess : roleChanged ? false : undefined,
        },
      });
      if (roleChanged) {
        // Permissions of the old role must not survive the change.
        if (toCustomer) {
          await tx.groupAccess.deleteMany({ where: { userId: p.id } });
          await tx.userCustomRole.deleteMany({ where: { userId: p.id } });
          await tx.apiToken.updateMany({
            where: { userId: p.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        } else {
          await tx.userSecondaryOrganization.deleteMany({ where: { userId: p.id } });
        }
      }
      if (body.secondaryOrganizationIds) {
        await tx.userSecondaryOrganization.deleteMany({ where: { userId: p.id } });
        await tx.userSecondaryOrganization.createMany({
          data: body.secondaryOrganizationIds
            .filter((o) => o !== organizationId)
            .map((organizationId) => ({ userId: p.id, organizationId })),
        });
      }
      if (body.customRoleIds) {
        await tx.userCustomRole.deleteMany({ where: { userId: p.id } });
        await tx.userCustomRole.createMany({
          data: body.customRoleIds.map((roleId) => ({ userId: p.id, roleId })),
        });
      }
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: roleChanged
            ? 'admin.user.role_changed'
            : body.customRoleIds
              ? 'admin.user.roles_changed'
              : 'admin.user.updated',
          targetType: 'user',
          targetId: p.id,
          organizationId,
          data: {
            changes: body,
            ...(roleChanged ? { roleBefore: target.role, roleAfter: role } : {}),
            ...(orgChanged ? { organizationBefore: target.organizationId } : {}),
          },
        },
        tx,
      );
    });
    // A new role or organization starts with a fresh sign-in (staff must have MFA).
    if (body.status === 'DISABLED' || roleChanged || orgChanged)
      await this.sessions.destroyAll(p.id);
    return this.user({ id: p.id });
  }

  @Put('users/:id/group-access')
  @RequirePermissions(Permission.UsersInviteStaff)
  @RequireReauth()
  async groupAccess(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(GroupAccessSchema)) body: z.infer<typeof GroupAccessSchema>,
  ) {
    const target = await this.prisma.user.findUnique({ where: { id: p.id } });
    if (!target || target.role === 'CUSTOMER') throw new AppError('not_found');
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.groupAccess.findMany({ where: { userId: p.id } });
      await tx.groupAccess.deleteMany({ where: { userId: p.id } });
      await tx.groupAccess.createMany({
        data: body.map((g) => ({
          userId: p.id,
          groupId: g.groupId,
          levels: [...new Set(g.levels)],
        })),
      });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'admin.user.group_access_changed',
          targetType: 'user',
          targetId: p.id,
          data: {
            before: before.map((g) => ({ groupId: g.groupId, levels: g.levels })),
            after: body,
          },
        },
        tx,
      );
    });
    return this.user({ id: p.id });
  }

  @Patch('organizations/:id')
  @RequirePermissions(Permission.OrganizationsWrite)
  async updateOrganization(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(OrganizationUpdateSchema)) body: z.infer<typeof OrganizationUpdateSchema>,
  ) {
    const before = await this.prisma.organization.findUnique({ where: { id: p.id } });
    if (!before) throw new AppError('not_found');
    // Sending customer data to an AI provider is a configuration decision (section 5.12).
    if (
      body.aiEnabled !== undefined &&
      !req.auth!.user.permissions.includes(Permission.AdminConfig)
    )
      throw new AppError('forbidden');
    if (
      body.inncentivesTenantKey &&
      (await this.prisma.organization.findFirst({
        where: { inncentivesTenantKey: body.inncentivesTenantKey, NOT: { id: p.id } },
      }))
    )
      throw new AppError('conflict', 'Another organization already uses this tenant key.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const o = await tx.organization.update({ where: { id: p.id }, data: body });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'admin.organization.updated',
          targetType: 'organization',
          targetId: p.id,
          organizationId: p.id,
          data: { changes: body },
        },
        tx,
      );
      return o;
    });
    return updated;
  }

  @Get('webhook-deliveries')
  @RequirePermissions(Permission.AdminConfig)
  deliveries(@Query(new ZodPipe(DeliveriesQuery)) q: z.infer<typeof DeliveriesQuery>) {
    return this.prisma.webhookDelivery.findMany({
      where: q.targetId ? { targetId: q.targetId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ---------------------------------------------------------- data privacy

  @Get('privacy-tasks')
  @RequirePermissions(Permission.DataPrivacy)
  privacyTasks() {
    return this.privacy.list();
  }

  @Post('privacy-tasks')
  @RequirePermissions(Permission.DataPrivacy)
  @RequireReauth()
  createPrivacyTask(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(PrivacyTaskSchema)) body: z.infer<typeof PrivacyTaskSchema>,
  ) {
    return this.privacy.request(req, body);
  }

  @Get('privacy-tasks/:id/download')
  @RequirePermissions(Permission.DataPrivacy)
  @RequireReauth()
  privacyDownload(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
  ) {
    return this.privacy.exportUrl(req, p.id);
  }

  // -------------------------------------------------------- view as customer

  @Post('view-as')
  @RequirePermissions(Permission.ViewAsCustomer)
  @RequireReauth()
  startViewAs(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(ViewAsSchema)) body: z.infer<typeof ViewAsSchema>,
  ) {
    return this.viewAs.start(req, body.userId, body.reason);
  }

  @Get('view-as/:sid/tickets')
  @RequirePermissions(Permission.ViewAsCustomer)
  viewAsTickets(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(ViewAsParam)) p: z.infer<typeof ViewAsParam>,
    @Query('overview') overview?: string,
  ) {
    return this.viewAs.tickets(req, p.sid, overview);
  }

  @Get('view-as/:sid/tickets/:id')
  @RequirePermissions(Permission.ViewAsCustomer)
  viewAsTicket(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(ViewAsTicketParam)) p: z.infer<typeof ViewAsTicketParam>,
  ) {
    return this.viewAs.ticket(req, p.sid, p.id);
  }
}
