import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { TicketsModule } from '../tickets/tickets.module';
import { EmailChannelsService } from './email/email-channels.service';
import { MailIngestService } from './email/ingest.service';
import { MessagingHooksController } from './messaging/messaging.controller';
import { MessagingService } from './messaging/messaging.service';
import { HooksController, PhoneController } from './phone/phone.controller';
import { PhoneService } from './phone/phone.service';

@Module({
  imports: [TicketsModule, AttachmentsModule],
  controllers: [PhoneController, HooksController, MessagingHooksController],
  providers: [PhoneService, MailIngestService, EmailChannelsService, MessagingService],
  exports: [MailIngestService, EmailChannelsService, MessagingService],
})
export class ChannelsModule {}
