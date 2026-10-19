import { Body, Controller, Get, Module, Param, Post, Req } from '@nestjs/common';
import { Permission, UuidParamSchema } from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-validation.pipe';
import { KbModule } from '../kb/kb.module';
import { Area, RequirePermissions } from '../policy/decorators';
import { TicketsModule } from '../tickets/tickets.module';
import { AiService } from './ai.service';

const SuggestSchema = z.object({ locale: z.enum(['es-MX', 'en']).default('es-MX') }).strict();
const ComposeSchema = z
  .object({
    draft: z.string().trim().min(1).max(8000),
    mode: z.enum(['improve', 'formal', 'shorter', 'to_en', 'to_es']),
  })
  .strict();

/** AI suggestions for agents; nothing here is ever sent to the customer. */
@Controller('tickets/:id/ai')
@Area('agent')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get()
  @RequirePermissions(Permission.TicketsAgent)
  status(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    return this.ai.availability(req.auth!.user, p.id);
  }

  @Post('summary')
  @RequirePermissions(Permission.TicketsAgent)
  summary(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    return this.ai.summary(req, p.id);
  }

  @Post('suggest')
  @RequirePermissions(Permission.TicketsAgent)
  suggest(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(SuggestSchema)) b: z.infer<typeof SuggestSchema>,
  ) {
    return this.ai.suggest(req, p.id, b.locale);
  }

  @Post('classify')
  @RequirePermissions(Permission.TicketsAgent)
  classify(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    return this.ai.classify(req, p.id);
  }

  @Post('compose')
  @RequirePermissions(Permission.TicketsAgent)
  compose(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(ComposeSchema)) b: z.infer<typeof ComposeSchema>,
  ) {
    return this.ai.compose(req, p.id, b.draft, b.mode);
  }
}

@Module({
  imports: [TicketsModule, KbModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
