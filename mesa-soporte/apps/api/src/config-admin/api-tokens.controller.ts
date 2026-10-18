import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Permission, UuidParamSchema } from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { ZodPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { Area, RequirePermissions, RequireReauth } from '../policy/decorators';
import { newToken, sha256Hex } from '../security/tokens';

const CreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    scopes: z.array(z.string().max(60)).min(1).max(30),
    expiresInDays: z.number().int().min(1).max(365),
  })
  .strict();

/** Personal API tokens: shown once, stored as hash, scoped and expiring. */
@Controller('me/api-tokens')
@Area('agent')
export class ApiTokensController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(Permission.TicketsAgent)
  async list(@Req() req: FastifyRequest) {
    const rows = await this.prisma.apiToken.findMany({
      where: { userId: req.auth!.user.id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ tokenHash: _hash, ...r }) => r);
  }

  @Post()
  @RequirePermissions(Permission.TicketsAgent)
  @RequireReauth()
  async create(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(CreateSchema)) body: z.infer<typeof CreateSchema>,
  ) {
    const actor = req.auth!.user;
    if (req.auth!.apiTokenId) throw new AppError('forbidden');
    const scopes = [...new Set(body.scopes)];
    if (scopes.some((s) => !actor.permissions.includes(s as Permission))) {
      throw new AppError('validation_failed', 'Scopes must be permissions you hold.', [
        { path: 'scopes', code: 'invalid' },
      ]);
    }
    const raw = `mesa_${newToken()}`;
    const row = await this.prisma.$transaction(async (tx) => {
      const t = await tx.apiToken.create({
        data: {
          userId: actor.id,
          name: body.name,
          tokenHash: sha256Hex(raw),
          scopes,
          expiresAt: new Date(Date.now() + body.expiresInDays * 86_400_000),
        },
      });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'api_token.created',
          targetType: 'api_token',
          targetId: t.id,
          data: { name: t.name, scopes, expiresAt: t.expiresAt },
        },
        tx,
      );
      return t;
    });
    return { id: row.id, name: row.name, scopes: row.scopes, expiresAt: row.expiresAt, token: raw };
  }

  @Delete(':id')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async revoke(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    const res = await this.prisma.apiToken.updateMany({
      where: { id: p.id, userId: req.auth!.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!res.count) throw new AppError('not_found');
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'api_token.revoked',
      targetType: 'api_token',
      targetId: p.id,
    });
  }
}
