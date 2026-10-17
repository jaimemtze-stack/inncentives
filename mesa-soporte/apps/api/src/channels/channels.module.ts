import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { TicketsModule } from '../tickets/tickets.module';
import { EmailChannelsService } from './email/email-channels.service';
import { MailIngestService } from './email/ingest.service';
import { HooksController, PhoneController } from './phone/phone.controller';
import { PhoneService } from './phone/phone.service';

@Module({
  imports: [TicketsModule, AttachmentsModule],
  controllers: [PhoneController, HooksController],
  providers: [PhoneService, MailIngestService, EmailChannelsService],
  exports: [MailIngestService, EmailChannelsService],
})
export class ChannelsModule {}
