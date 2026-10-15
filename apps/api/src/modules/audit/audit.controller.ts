import { Controller, Get, Query } from '@nestjs/common';
import { paginationSchema } from '@inn/shared';
import { z } from 'zod';
import { RequirePermission } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from './audit.service';

const auditQuerySchema = paginationSchema.extend({
  cursor: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional(),
  action: z.string().max(100).optional(),
  actorId: z.string().uuid().optional(),
  objectType: z.string().max(50).optional(),
  objectId: z.string().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

@Controller('admin/audit')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('admin.audit')
  async list(@Query(new ZodPipe(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(q.action ? { action: q.action } : {}),
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.objectType ? { objectType: q.objectType } : {}),
        ...(q.objectId ? { objectId: q.objectId } : {}),
        ...(q.from || q.to
          ? { occurredAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
          : {}),
        ...(q.cursor ? { id: { lt: BigInt(q.cursor) } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => ({ ...r, id: r.id.toString() })),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.id.toString() : null,
    };
  }

  @Get('verify')
  @RequirePermission('admin.audit')
  verify() {
    return this.audit.verifyChain();
  }
}
