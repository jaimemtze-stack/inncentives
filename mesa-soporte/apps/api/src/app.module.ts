import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/exception.filter';
import type { AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { AuthzGuard } from './policy/authz.guard';
import { PolicyModule } from './policy/policy.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { SecurityModule } from './security/security.module';
import { StorageModule } from './storage/storage.module';
import { EventsModule } from './events/ticket-events';
import { SettingsModule } from './settings/settings.module';
import { TicketsModule } from './tickets/tickets.module';

const featureModules = [
  PrismaModule,
  RedisModule,
  SecurityModule,
  PolicyModule,
  AuditModule,
  MailModule,
  StorageModule,
  HealthModule,
  AuthModule,
  AdminModule,
  EventsModule,
  SettingsModule,
  TicketsModule,
];

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), ...featureModules],
      providers: [
        { provide: APP_GUARD, useClass: AuthzGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
