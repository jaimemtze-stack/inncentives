import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Permission, UuidParamSchema } from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-validation.pipe';
import { Area, Public, RequirePermissions } from '../policy/decorators';
import { DevOpsService } from './devops.service';

const CreateSchema = z
  .object({
    type: z.enum(['Bug', 'Task', 'User Story', 'Issue']).optional(),
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(5000).optional(),
  })
  .strict();
const LinkSchema = z.object({ workItemId: z.number().int().positive() }).strict();
const LinkParam = z.object({ id: z.string().uuid(), linkId: z.string().uuid() });

@Controller('tickets/:id/devops')
@Area('agent')
export class DevOpsController {
  constructor(private readonly devops: DevOpsService) {}

  @Get()
  @RequirePermissions(Permission.TicketsAgent)
  list(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    return this.devops.list(req, p.id);
  }

  @Post()
  @RequirePermissions(Permission.TicketsAgent)
  create(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(CreateSchema)) body: z.infer<typeof CreateSchema>,
  ) {
    return this.devops.create(req, p.id, body);
  }

  @Post('link')
  @RequirePermissions(Permission.TicketsAgent)
  link(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(LinkSchema)) body: z.infer<typeof LinkSchema>,
  ) {
    return this.devops.link(req, p.id, body.workItemId);
  }

  @Delete(':linkId')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async unlink(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(LinkParam)) p: z.infer<typeof LinkParam>,
  ) {
    await this.devops.unlink(req, p.id, p.linkId);
  }
}

/** Azure DevOps service hook (work item updated), authenticated with basic credentials. */
@Controller('hooks')
export class DevOpsHookController {
  constructor(private readonly devops: DevOpsService) {}

  @Post('azure-devops')
  @Public('any')
  @HttpCode(204)
  async hook(@Req() req: FastifyRequest, @Body() body: unknown) {
    await this.devops.hook(req.headers.authorization, body);
  }
}
