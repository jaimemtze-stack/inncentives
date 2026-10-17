import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import {
  InvitationCreateSchema,
  OrganizationCreateSchema,
  PaginationSchema,
  Permission,
  UuidParamSchema,
} from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { ZodPipe } from '../common/zod-validation.pipe';
import { AdminService } from './admin.service';
import { Area, RequirePermissions } from '../policy/decorators';

const UserListQuery = PaginationSchema.extend({
  organizationId: z.string().uuid().optional(),
}).strict();
const AuditQuery = PaginationSchema.extend({
  action: z.string().max(80).optional(),
  actorUserId: z.string().uuid().optional(),
}).strict();

/** Staff-only administration. Every route is pinned to the agents host. */
@Controller('admin')
@Area('agent')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) {}

  @Get('organizations')
  @RequirePermissions(Permission.OrganizationsRead)
  organizations(
    @Req() req: FastifyRequest,
    @Query(new ZodPipe(PaginationSchema)) q: z.infer<typeof PaginationSchema>,
  ) {
    return this.admin.listOrganizations(req.auth!.user, q);
  }

  @Post('organizations')
  @RequirePermissions(Permission.OrganizationsWrite)
  createOrganization(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(OrganizationCreateSchema)) body: z.infer<typeof OrganizationCreateSchema>,
  ) {
    return this.admin.createOrganization(req, body);
  }

  @Get('users')
  @RequirePermissions(Permission.UsersRead)
  users(
    @Req() req: FastifyRequest,
    @Query(new ZodPipe(UserListQuery)) q: z.infer<typeof UserListQuery>,
  ) {
    return this.admin.listUsers(req.auth!.user, q);
  }

  @Post('invitations')
  @RequirePermissions(Permission.UsersInviteCustomer)
  invite(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(InvitationCreateSchema)) body: z.infer<typeof InvitationCreateSchema>,
  ) {
    return this.admin.createInvitation(req, body);
  }

  @Delete('invitations/:id')
  @RequirePermissions(Permission.UsersInviteCustomer)
  @HttpCode(204)
  async revokeInvitation(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
  ) {
    await this.admin.revokeInvitation(req, p.id);
  }

  @Post('users/:id/sessions/revoke')
  @RequirePermissions(Permission.UsersManageSessions)
  async revokeUserSessions(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
  ) {
    return { revoked: await this.admin.revokeUserSessions(req, p.id) };
  }

  @Get('audit-logs')
  @RequirePermissions(Permission.AuditRead)
  auditLogs(@Query(new ZodPipe(AuditQuery)) q: z.infer<typeof AuditQuery>) {
    return this.admin.listAuditLogs(q);
  }

  @Get('audit-logs/verify')
  @RequirePermissions(Permission.AuditRead)
  async verifyAudit(@Req() req: FastifyRequest) {
    const result = await this.audit.verifyChain();
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'audit.chain.verified',
      data: result,
    });
    if (!result.ok)
      throw new AppError('internal_error', 'Audit chain verification failed.', result, 500);
    return result;
  }
}
