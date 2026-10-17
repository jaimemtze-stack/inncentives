import { Body, Controller, Get, HttpCode, Patch, Post, Query, Req } from '@nestjs/common';
import { Permission } from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { ZodPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { RequirePermissions } from '../policy/decorators';

const ListQuery = z
  .object({
    unread: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
const ReadSchema = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
const Kinds = z.enum([
  'ticket_created',
  'ticket_assigned',
  'customer_reply',
  'ticket_updated',
  'mention',
  'reminder_reached',
  'sla_warning',
  'sla_breach',
  'trigger',
]);
const PreferencesSchema = z
  .object({
    locale: z.enum(['es-MX', 'en']).optional(),
    notificationPrefs: z
      .object({ email: z.record(Kinds, z.boolean()).optional() })
      .strict()
      .optional(),
    outOfOffice: z.boolean().optional(),
    outOfOfficeUntil: z.coerce.date().nullable().optional(),
    replacementId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** In-app notifications and personal preferences of the signed-in user. */
@Controller('me')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('notifications')
  @RequirePermissions(Permission.SelfManage)
  async list(
    @Req() req: FastifyRequest,
    @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>,
  ) {
    const userId = req.auth!.user.id;
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, ...(q.unread === 'true' ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        include: { ticket: { select: { id: true, number: true } } },
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      unread,
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        ticket: n.ticket,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
    };
  }

  @Post('notifications/read')
  @RequirePermissions(Permission.SelfManage)
  @HttpCode(204)
  async read(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(ReadSchema)) body: z.infer<typeof ReadSchema>,
  ) {
    await this.prisma.notification.updateMany({
      where: {
        userId: req.auth!.user.id,
        readAt: null,
        ...('ids' in body ? { id: { in: body.ids } } : {}),
      },
      data: { readAt: new Date() },
    });
  }

  @Get('preferences')
  @RequirePermissions(Permission.SelfManage)
  async preferences(@Req() req: FastifyRequest) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: req.auth!.user.id } });
    return {
      locale: u.locale,
      notificationPrefs: u.notificationPrefs,
      outOfOffice: u.outOfOffice,
      outOfOfficeUntil: u.outOfOfficeUntil,
      replacementId: u.replacementId,
    };
  }

  @Patch('preferences')
  @RequirePermissions(Permission.SelfManage)
  async update(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(PreferencesSchema)) body: z.infer<typeof PreferencesSchema>,
  ) {
    const actor = req.auth!.user;
    const staffOnly =
      body.outOfOffice !== undefined ||
      body.replacementId !== undefined ||
      body.outOfOfficeUntil !== undefined;
    if (staffOnly && actor.role === 'CUSTOMER') throw new AppError('forbidden');
    if (body.replacementId) {
      const rep = await this.prisma.user.findFirst({
        where: {
          id: body.replacementId,
          status: 'ACTIVE',
          role: { in: ['ADMIN', 'AGENT'] },
          NOT: { id: actor.id },
        },
      });
      if (!rep)
        throw new AppError('validation_failed', 'Invalid replacement.', [
          { path: 'replacementId', code: 'invalid' },
        ]);
    }
    await this.prisma.user.update({
      where: { id: actor.id },
      data: {
        locale: body.locale,
        notificationPrefs: body.notificationPrefs,
        outOfOffice: body.outOfOffice,
        outOfOfficeUntil: body.outOfOfficeUntil,
        replacementId: body.replacementId,
      },
    });
    return this.preferences(req);
  }
}
