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
import { ImportService } from './import.service';
import { Area, RequirePermissions, RequireReauth } from '../policy/decorators';

const UserListQuery = PaginationSchema.extend({
  organizationId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
  role: z.enum(['ADMIN', 'AGENT', 'CUSTOMER']).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
}).strict();
const ImportSchema = z
  .object({ csv: z.string().min(1).max(900_000), dryRun: z.boolean().default(true) })
  .strict();
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
    private readonly imports: ImportService,
  ) {}

  /** CSV import: run with dryRun first; nothing is written while any row has errors. */
  @Post('import/organizations')
  @RequirePermissions(Permission.OrganizationsWrite)
  @HttpCode(200)
  importOrganizations(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(ImportSchema)) body: z.infer<typeof ImportSchema>,
  ) {
    return this.imports.organizations(req, body.csv, body.dryRun);
  }

  @Post('import/users')
  @RequirePermissions(Permission.UsersInviteCustomer)
  @HttpCode(200)
  importUsers(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(ImportSchema)) body: z.infer<typeof ImportSchema>,
  ) {
    return this.imports.users(req, body.csv, body.dryRun);
  }

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

  /** Pending invitations the actor may manage (not accepted, not revoked). */
  @Get('invitations')
  @RequirePermissions(Permission.UsersInviteCustomer)
  invitations(@Req() req: FastifyRequest) {
    return this.admin.listPendingInvitations(req.auth!.user);
  }

  /** Sends a new link; the previous one stops working. */
  @Post('invitations/:id/resend')
  @RequirePermissions(Permission.UsersInviteCustomer)
  resendInvitation(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
  ) {
    return this.admin.resendInvitation(req, p.id);
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

  /**
   * Removes the user's second factors (app, passkeys, recovery codes) and signs them out.
   * Staff must set up a new factor at their next sign-in.
   */
  @Post('users/:id/mfa/reset')
  @RequirePermissions(Permission.UsersManageSessions)
  @RequireReauth()
  @HttpCode(204)
  async resetMfa(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
  ) {
    await this.admin.resetMfa(req, p.id);
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
