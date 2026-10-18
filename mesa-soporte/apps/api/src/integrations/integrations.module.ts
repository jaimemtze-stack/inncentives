import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { DevOpsController, DevOpsHookController } from './devops.controller';
import { DevOpsService } from './devops.service';
import { INNCENTIVES_CLIENT, MockInncentivesClient } from './inncentives/inncentives.client';

@Module({
  imports: [TicketsModule],
  controllers: [DevOpsController, DevOpsHookController],
  // Phase 3 replaces the mock with the HTTP client once the Inncentives API exists.
  providers: [DevOpsService, { provide: INNCENTIVES_CLIENT, useClass: MockInncentivesClient }],
  exports: [DevOpsService, INNCENTIVES_CLIENT],
})
export class IntegrationsModule {}
