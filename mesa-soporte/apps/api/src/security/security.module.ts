import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { FieldEncryption } from './field-encryption';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

@Global()
@Module({
  providers: [
    SessionService,
    RateLimitService,
    PasswordService,
    TotpService,
    {
      provide: FieldEncryption,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new FieldEncryption(config.fieldEncryptionKeys),
    },
  ],
  exports: [SessionService, RateLimitService, PasswordService, TotpService, FieldEncryption],
})
export class SecurityModule {}
