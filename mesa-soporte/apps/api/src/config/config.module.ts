import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from './config';
import { FileSecretsProvider } from './secrets';

/** Reads secrets by name at use time (channel passwords, webhook keys…). */
export const SECRETS = Symbol('SECRETS');

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: SECRETS,
          useValue: new FileSecretsProvider(config.SECRETS_DIR, config.NODE_ENV !== 'production'),
        },
      ],
      exports: [APP_CONFIG, SECRETS],
    };
  }
}
