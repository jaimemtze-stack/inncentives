import { Module } from '@nestjs/common';
import { PrivacyModule } from '../privacy/privacy.module';
import { TicketsModule } from '../tickets/tickets.module';
import { ApiTokensController } from './api-tokens.controller';
import { ConfigAdminController } from './config-admin.controller';
import { ConfigAdminService } from './config-admin.service';
import { ViewAsService } from './view-as.service';

@Module({
  imports: [TicketsModule, PrivacyModule],
  controllers: [ConfigAdminController, ApiTokensController],
  providers: [ConfigAdminService, ViewAsService],
})
export class ConfigAdminModule {}
