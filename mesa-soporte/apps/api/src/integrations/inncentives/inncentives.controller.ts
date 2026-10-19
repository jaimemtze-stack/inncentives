import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Permission, PortalTicketCreateSchema, UuidParamSchema } from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service';
import { ZodPipe } from '../../common/zod-validation.pipe';
import { Area, RequirePermissions } from '../../policy/decorators';
import { TicketExtrasService } from '../../tickets/ticket-extras.service';
import { TicketService } from '../../tickets/ticket.service';
import { InncentivesService } from './inncentives.service';
import { WidgetService } from './widget.service';

const Token = z.string().min(20).max(4000);
const ContextSchema = z.object({ token: Token }).strict();
const WidgetTicketSchema = PortalTicketCreateSchema.omit({ customFields: true }).extend({
  token: Token,
});

@Controller('tickets/:id/inncentives')
@Area('agent')
export class InncentivesController {
  constructor(private readonly inncentives: InncentivesService) {}

  /** Customer environments, failed process runs and Bitácora events (sidebar). */
  @Get()
  @RequirePermissions(Permission.TicketsAgent)
  get(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    return this.inncentives.forTicket(req.auth!.user, p.id);
  }
}

/** "Reportar un problema" opened from inside Inncentives (portal host). */
@Controller('widget')
@Area('portal')
export class WidgetController {
  constructor(
    private readonly widget: WidgetService,
    private readonly tickets: TicketService,
    private readonly extras: TicketExtrasService,
    private readonly audit: AuditService,
  ) {}

  /** Verifies the context token and returns what will be attached to the ticket. */
  @Post('context')
  @RequirePermissions(Permission.TicketsCustomer)
  async context(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(ContextSchema)) body: z.infer<typeof ContextSchema>,
  ) {
    const ctx = await this.widget.verify(req.auth!.user, body.token);
    return {
      environment: ctx.environment,
      module: ctx.module ?? null,
      url: ctx.url ?? null,
      version: ctx.version ?? null,
      reportedAt: ctx.reportedAt,
    };
  }

  @Post('tickets')
  @RequirePermissions(Permission.TicketsCustomer)
  async create(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(WidgetTicketSchema)) body: z.infer<typeof WidgetTicketSchema>,
  ) {
    const actor = req.auth!.user;
    const ctx = await this.widget.verify(actor, body.token);
    await this.widget.consume(ctx);
    const { token: _token, ...input } = body;
    const id = await this.tickets.createByCustomer(
      actor,
      { ...input, customFields: this.widget.customFields(ctx) },
      { channel: 'widget' },
    );
    await this.tickets.addArticleCore(
      await this.tickets.loadForRules(id),
      {
        type: 'note',
        sender: 'system',
        internal: true,
        body: this.widget.summary(ctx),
        isHtml: false,
      },
      { actorId: null },
    );
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'widget.ticket_created',
      targetType: 'ticket',
      targetId: id,
      organizationId: actor.organizationId,
      data: { tenant: ctx.tenant, environment: ctx.environment.id, jti: ctx.jti },
    });
    return this.extras.get(actor, id);
  }
}
