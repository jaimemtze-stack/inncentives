import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { MAIL_QUEUE_NAME, type MailQueue, type TransactionalMail } from './mail-queue';

@Injectable()
export class BullMqMailQueue implements MailQueue, OnModuleDestroy {
  private readonly queue: Queue;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const url = new URL(config.REDIS_URL);
    this.queue = new Queue(MAIL_QUEUE_NAME, {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
        password: url.password || undefined,
      },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 1000,
      },
    });
  }

  async enqueue(mail: TransactionalMail): Promise<void> {
    await this.queue.add(mail.template, mail);
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
