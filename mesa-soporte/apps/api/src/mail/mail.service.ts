import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { MAIL_QUEUE, type HostArea, type MailJob } from '@mesa/shared';
import { Queue } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/config';
import { bullConnection } from '../queue/bull-connection';

@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly queue: Queue<MailJob>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.queue = new Queue<MailJob>(MAIL_QUEUE, {
      connection: bullConnection(config.redisUrl),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        // Jobs can carry one-time links: do not keep them in Redis after delivery.
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
      },
    });
  }

  async send(job: MailJob): Promise<void> {
    await this.queue.add(job.template, job);
  }

  /**
   * Builds a link to the web app of an area. One-time tokens go in the URL
   * fragment, which browsers never send to servers or in Referer headers.
   */
  link(area: HostArea, path: string, fragmentToken?: string): string {
    const host = area === 'agent' ? this.config.AGENT_HOST : this.config.PORTAL_HOST;
    const base = `${this.config.PUBLIC_SCHEME}://${host}${path}`;
    return fragmentToken ? `${base}#token=${fragmentToken}` : base;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
