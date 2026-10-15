import { Controller, Delete, Get, HttpCode, NotFoundException, Param, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AreaOnly, Authenticated } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { SessionService } from './session.service';

const publicIdSchema = z.string().regex(/^[a-f0-9]{16}$/);

@Controller('auth/sessions')
@AreaOnly('any')
export class SessionsController {
  constructor(
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Authenticated()
  async list(@Req() req: FastifyRequest) {
    const current = req.session!;
    const all = await this.sessions.list(current.userId);
    return {
      items: all.map((s) => ({
        id: this.sessions.publicId(s),
        current: s.hash === current.hash,
        area: s.area,
        createdAt: new Date(s.createdAt).toISOString(),
        lastSeenAt: new Date(s.lastSeenAt).toISOString(),
        ip: s.ip,
        userAgent: s.userAgent,
      })),
    };
  }

  @Delete(':id')
  @Authenticated()
  @HttpCode(204)
  async revoke(@Param('id', new ZodPipe(publicIdSchema)) id: string, @Req() req: FastifyRequest) {
    const ok = await this.sessions.revokeByPublicId(req.session!.userId, id);
    if (!ok) throw new NotFoundException();
    await this.audit.record({
      action: 'auth.session.revoked',
      actorId: req.session!.userId,
      objectType: 'User',
      objectId: req.session!.userId,
      ip: req.clientIp,
      correlationId: req.correlationId,
    });
  }
}
