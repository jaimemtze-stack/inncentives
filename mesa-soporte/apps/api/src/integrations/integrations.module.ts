import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { DevOpsController, DevOpsHookController } from './devops.controller';
import { DevOpsService } from './devops.service';

@Module({
  imports: [TicketsModule],
  controllers: [DevOpsController, DevOpsHookController],
  providers: [DevOpsService],
  exports: [DevOpsService],
})
export class IntegrationsModule {}
