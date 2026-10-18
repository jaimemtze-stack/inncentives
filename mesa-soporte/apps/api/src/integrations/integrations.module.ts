import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { DevOpsController, DevOpsHookController } from './devops.controller';
import { DevOpsService } from './devops.service';
import { InncentivesController, WidgetController } from './inncentives/inncentives.controller';
import { InncentivesService } from './inncentives/inncentives.service';
import { WidgetService } from './inncentives/widget.service';

@Module({
  imports: [TicketsModule],
  controllers: [DevOpsController, DevOpsHookController, InncentivesController, WidgetController],
  providers: [DevOpsService, InncentivesService, WidgetService],
  exports: [DevOpsService, InncentivesService],
})
export class IntegrationsModule {}
