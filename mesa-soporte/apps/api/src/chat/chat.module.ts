import { Body, Controller, Get, Module, Param, Post, Req } from '@nestjs/common';
import { Permission, UuidParamSchema } from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-validation.pipe';
import { Area, RequireAnyPermission, RequirePermissions } from '../policy/decorators';
import { TicketsModule } from '../tickets/tickets.module';
import { ChatService } from './chat.service';

const Message = z.string().trim().min(1).max(4000);
const StartSchema = z
  .object({ message: Message, origin: z.enum(['portal', 'widget']).default('portal') })
  .strict();
const MessageSchema = z.object({ body: Message }).strict();
const AvailabilitySchema = z.object({ available: z.boolean() }).strict();

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('status')
  @Area('portal')
  @RequirePermissions(Permission.TicketsCustomer)
  status(@Req() req: FastifyRequest) {
    return this.chat.status(req.auth!.user);
  }

  @Post('sessions')
  @Area('portal')
  @RequirePermissions(Permission.TicketsCustomer)
  start(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(StartSchema)) b: z.infer<typeof StartSchema>,
  ) {
    return this.chat.start(req.auth!.user, b.message, b.origin);
  }

  @Post('availability')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  availability(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(AvailabilitySchema)) b: z.infer<typeof AvailabilitySchema>,
  ) {
    return this.chat.setAvailability(req.auth!.user, b.available);
  }

  @Get('queue')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  queue(@Req() req: FastifyRequest) {
    return this.chat.queue(req.auth!.user);
  }

  @Post('sessions/:id/accept')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  accept(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    return this.chat.accept(req.auth!.user, p.id);
  }

  @Post('sessions/:id/messages')
  @RequireAnyPermission(Permission.TicketsAgent, Permission.TicketsCustomer)
  send(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(MessageSchema)) b: z.infer<typeof MessageSchema>,
  ) {
    return this.chat.send(req.auth!.user, p.id, b.body);
  }

  @Post('sessions/:id/end')
  @RequireAnyPermission(Permission.TicketsAgent, Permission.TicketsCustomer)
  end(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    const user = req.auth!.user;
    return this.chat.end(user, p.id, user.role === 'CUSTOMER' ? 'customer' : 'agent');
  }
}

@Module({
  imports: [TicketsModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
