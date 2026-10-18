import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Permission } from '@mesa/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-validation.pipe';
import { Area, RequirePermissions } from '../policy/decorators';
import { ReportsService } from './reports.service';

const FilterQuery = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    organizationId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
    ownerId: z.string().uuid().optional(),
  })
  .strict();
const ExportQuery = FilterQuery.extend({ format: z.enum(['csv', 'xlsx']) });

@Controller('reports')
@Area('agent')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @RequirePermissions(Permission.Reports)
  summary(
    @Req() req: FastifyRequest,
    @Query(new ZodPipe(FilterQuery)) q: z.infer<typeof FilterQuery>,
  ) {
    return this.reports.summary(req.auth!.user, q);
  }

  @Get('export')
  @RequirePermissions(Permission.Reports)
  async export(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query(new ZodPipe(ExportQuery)) q: z.infer<typeof ExportQuery>,
  ) {
    const { format, ...filter } = q;
    const file = await this.reports.export(req, filter, format);
    const name = `tickets-${q.from.toISOString().slice(0, 10)}-${q.to.toISOString().slice(0, 10)}.${file.ext}`;
    return reply
      .header('Content-Type', file.contentType)
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(file.body);
  }
}
