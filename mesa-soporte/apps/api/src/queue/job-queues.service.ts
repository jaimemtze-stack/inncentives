import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { JobQueues as Q } from '@mesa/shared';
import { Queue, type JobsOptions } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/config';
import { bullConnection } from './bull-connection';

export interface WebhookJob {
  webhookId: string;
  ticketId: string;
  triggerId: string | null;
}

const DEFAULTS: JobsOptions = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 3600 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/** Producer side of the jobs service queues. Job ids dedupe repeated enqueues. */
@Injectable()
export class JobQueuesService implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: bullConnection(this.config.redisUrl),
        defaultJobOptions: DEFAULTS,
      });
      this.queues.set(name, q);
    }
    return q;
  }

  /** An article is sent at most once even if enqueued twice. */
  async outbound(articleId: string): Promise<void> {
    await this.queue(Q.outbound).add('send', { articleId }, { jobId: `article-${articleId}` });
  }

  async webhook(job: WebhookJob): Promise<void> {
    await this.queue(Q.webhooks).add('call', job, { attempts: 5 });
  }

  async scan(attachmentId: string): Promise<void> {
    await this.queue(Q.scan).add(
      'scan',
      { attachmentId },
      { jobId: `scan-${attachmentId}`, attempts: 5 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
