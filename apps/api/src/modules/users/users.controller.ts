import { Body, Controller, Delete, HttpCode, Param, Post, Req } from '@nestjs/common';
import { inviteUserSchema, uuidSchema, type InviteUserInput } from '@inn/shared';
import type { FastifyRequest } from 'fastify';
import { CurrentActor, RequirePermission } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { ZodPipe } from '../../common/http/zod.pipe';
import { UsersService } from './users.service';

@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post('invitations')
  @RequirePermission('admin.user', 'ticket.agent')
  @HttpCode(201)
  invite(
    @Body(new ZodPipe(inviteUserSchema)) body: InviteUserInput,
    @CurrentActor() actor: Actor,
    @Req() req: FastifyRequest,
  ) {
    return this.users.invite(actor, body, { ip: req.clientIp, correlationId: req.correlationId });
  }

  @Delete(':id/sessions')
  @RequirePermission('admin.user')
  @HttpCode(200)
  revokeSessions(
    @Param('id', new ZodPipe(uuidSchema)) id: string,
    @CurrentActor() actor: Actor,
    @Req() req: FastifyRequest,
  ) {
    return this.users.revokeSessions(actor, id, {
      ip: req.clientIp,
      correlationId: req.correlationId,
    });
  }
}
