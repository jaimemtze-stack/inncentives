import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { OUTBOUND_QUEUE } from '@mesa/shared';
import { Queue } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/config';
import { bullConnection } from './bull-connection';

export interface OutboundJob {
  articleId: string;
}

/** Queues outbound ticket e-mails; the jobs service builds and sends them. */
@Injectable()
export class OutboundService implements OnModuleDestroy {
  private readonly queue: Queue<OutboundJob>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.queue = new Queue<OutboundJob>(OUTBOUND_QUEUE, {
      connection: bullConnection(config.redisUrl),
      defaultJobOptions: {
        attempts: 8,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 24 * 3600 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }

  async enqueue(articleId: string): Promise<void> {
    // jobId dedupes: an article is sent at most once even if enqueued twice.
    await this.queue.add('send', { articleId }, { jobId: `article-${articleId}` });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
