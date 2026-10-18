import { Controller, Get, Module, Query, Req } from '@nestjs/common';
import { Permission } from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-validation.pipe';
import { KbModule } from '../kb/kb.module';
import { RequireAnyPermission } from '../policy/decorators';
import { TicketsModule } from '../tickets/tickets.module';
import { SearchService } from './search.service';

const Query_ = z
  .object({ q: z.string().max(300), locale: z.enum(['es-MX', 'en']).optional() })
  .strict();

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('global')
  @RequireAnyPermission(Permission.TicketsAgent, Permission.TicketsCustomer)
  global(@Req() req: FastifyRequest, @Query(new ZodPipe(Query_)) q: z.infer<typeof Query_>) {
    return this.search.global(req.auth!.user, q.q, q.locale);
  }
}

@Module({
  imports: [TicketsModule, KbModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
