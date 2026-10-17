import { DynamicModule, Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AuditModule } from '../audit/audit.module';
import { ChannelsModule } from '../channels/channels.module';
import type { AppConfig } from '../config/config';
import { ConfigModule } from '../config/config.module';
import { EventsModule } from '../events/ticket-events';
import { MailModule } from '../mail/mail.module';
import { PolicyModule } from '../policy/policy.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrivacyModule } from '../privacy/privacy.module';
import { RedisModule } from '../redis/redis.module';
import { SecurityModule } from '../security/security.module';
import { SettingsModule } from '../settings/settings.module';
import { StorageModule } from '../storage/storage.module';
import { TicketsModule } from '../tickets/tickets.module';
import { JobsRunnerService } from './jobs-runner.service';
import { MaintenanceService } from './maintenance.service';
import { safePost } from './safe-fetch';
import { ScanService } from './scan.service';
import { WebhookCallerService } from './webhook-caller.service';

/** Providers of the jobs process (without the runner, so tests can use them directly). */
export const jobProviders = [
  MaintenanceService,
  ScanService,
  WebhookCallerService,
  { provide: safePost, useValue: safePost },
];

@Module({})
export class JobsModule {
  static forRoot(config: AppConfig, opts: { runner?: boolean } = {}): DynamicModule {
    return {
      module: JobsModule,
      imports: [
        ConfigModule.forRoot(config),
        PrismaModule,
        RedisModule,
        SecurityModule,
        PolicyModule,
        AuditModule,
        MailModule,
        StorageModule,
        EventsModule,
        SettingsModule,
        TicketsModule,
        AttachmentsModule,
        ChannelsModule,
        PrivacyModule,
      ],
      providers: [...jobProviders, ...(opts.runner === false ? [] : [JobsRunnerService])],
      exports: jobProviders,
    };
  }
}
