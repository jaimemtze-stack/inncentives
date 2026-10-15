import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config/config';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(config.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false });
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit().catch(() => undefined);
  }
}
