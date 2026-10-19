import { Module } from '@nestjs/common';
import { SlaService } from '../automation/sla.service';
import { TriggersService } from '../automation/triggers.service';
import { WorkflowsService } from '../automation/workflows.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OverviewsService } from '../overviews/overviews.service';
import { JobQueuesService } from '../queue/job-queues.service';
import { TicketAccessService } from './access.service';
import { FormService } from './form.service';
import { MacrosService } from './macros.service';
import { TicketExtrasService } from './ticket-extras.service';
import { TicketService } from './ticket.service';
import { TicketsController } from './tickets.controller';

@Module({
  controllers: [TicketsController],
  providers: [
    TicketAccessService,
    TicketService,
    TicketExtrasService,
    MacrosService,
    FormService,
    OverviewsService,
    SlaService,
    TriggersService,
    WorkflowsService,
    NotificationsService,
    JobQueuesService,
  ],
  exports: [
    TicketAccessService,
    TicketService,
    TicketExtrasService,
    OverviewsService,
    SlaService,
    NotificationsService,
    JobQueuesService,
  ],
})
export class TicketsModule {}
