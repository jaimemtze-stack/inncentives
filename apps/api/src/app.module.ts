import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from './config/config';
import { AccessGuard } from './common/auth/access.guard';
import { ActorLoaderService } from './common/auth/actor-loader.service';
import { CsrfService } from './common/auth/csrf.service';
import { FIELD_CRYPTO, FieldCrypto } from './common/crypto/field-crypto';
import { ErrorFilter } from './common/http/error.filter';
import { BullMqMailQueue } from './common/mail/bullmq-mail-queue';
import { MAIL_QUEUE } from './common/mail/mail-queue';
import { PolicyService } from './common/policy/policy.service';
import { PrismaService } from './common/prisma/prisma.service';
import { RedisService } from './common/redis/redis.service';
import { AuditController } from './modules/audit/audit.controller';
import { AuditService } from './modules/audit/audit.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { LoginThrottleService } from './modules/auth/login-throttle.service';
import { OneTimeTokenService } from './modules/auth/one-time-token.service';
import { HIBP_FETCH, PasswordService } from './modules/auth/password.service';
import { SessionService } from './modules/auth/session.service';
import { SessionsController } from './modules/auth/sessions.controller';
import { HealthController } from './modules/health/health.controller';
import { UsersController } from './modules/users/users.controller';
import { UsersService } from './modules/users/users.service';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [DiscoveryModule],
      controllers: [
        HealthController,
        AuthController,
        SessionsController,
        UsersController,
        AuditController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: FIELD_CRYPTO, useValue: new FieldCrypto(config.fieldEncryptionKeys) },
        { provide: HIBP_FETCH, useValue: globalThis.fetch.bind(globalThis) },
        { provide: MAIL_QUEUE, useClass: BullMqMailQueue },
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
        PrismaService,
        RedisService,
        PolicyService,
        ActorLoaderService,
        CsrfService,
        AuditService,
        PasswordService,
        SessionService,
        LoginThrottleService,
        OneTimeTokenService,
        AuthService,
        UsersService,
      ],
    };
  }
}
