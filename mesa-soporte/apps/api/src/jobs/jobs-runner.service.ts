import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { JobQueues } from '@mesa/shared';
import { Queue, Worker, type Job } from 'bullmq';
import { EmailChannelsService, NotReadyError } from '../channels/email/email-channels.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { PrivacyService } from '../privacy/privacy.service';
import { bullConnection } from '../queue/bull-connection';
import type { WebhookJob } from '../queue/job-queues.service';
import { MaintenanceService } from './maintenance.service';
import { ScanService } from './scan.service';
import { WebhookCallerService } from './webhook-caller.service';

/** Periodic tasks and their interval. */
const SCHEDULE: Record<string, number> = {
  'mail-fetch': 60_000,
  'sla-check': 60_000,
  pending: 60_000,
  schedulers: 60_000,
  privacy: 60_000,
  cleanup: 3_600_000,
  retention: 6 * 3_600_000,
};

const isFinal = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

/**
 * BullMQ consumers of the jobs process. Runs the same code base as the API
 * with its own entry point (dist/jobs-main.js) and no HTTP listener.
 */
@Injectable()
export class JobsRunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private readonly workers: Worker[] = [];
  private maintenanceQueue?: Queue;

  constructor(
    private readonly channels: EmailChannelsService,
    private readonly scanner: ScanService,
    private readonly webhooks: WebhookCallerService,
    private readonly maintenance: MaintenanceService,
    private readonly privacy: PrivacyService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Runs one maintenance task by name (also used by tests). */
  async runTask(name: string): Promise<void> {
    switch (name) {
      case 'mail-fetch':
        return this.channels.fetchAll();
      case 'sla-check':
        await this.maintenance.slaCheck();
        return;
      case 'pending':
        return this.maintenance.pendingCheck();
      case 'schedulers':
        return this.maintenance.runSchedulers();
      case 'privacy':
        return this.privacy.processPending();
      case 'cleanup':
        return this.maintenance.cleanupStaged();
      case 'retention':
        return this.maintenance.retention();
      default:
        throw new Error(`Unknown task ${name}`);
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    const connection = bullConnection(this.config.redisUrl);
    const worker = <T>(queue: string, fn: (job: Job<T>) => Promise<void>, concurrency = 1) => {
      const w = new Worker<T>(queue, fn, { connection, concurrency });
      w.on('failed', (job, err) => {
        const level = err instanceof NotReadyError ? 'debug' : 'warn';
        this.logger[level](`${queue}/${job?.name} ${job?.id} failed: ${err.message}`);
      });
      this.workers.push(w);
    };
    worker<{ articleId: string }>(
      JobQueues.outbound,
      (job) => this.channels.sendArticle(job.data.articleId, isFinal(job)),
      2,
    );
    worker<{ attachmentId: string }>(
      JobQueues.scan,
      (job) => this.scanner.scan(job.data.attachmentId, isFinal(job)),
      2,
    );
    worker<WebhookJob>(JobQueues.webhooks, (job) => this.webhooks.call(job.data), 2);
    worker<Record<string, never>>(JobQueues.maintenance, (job) => this.runTask(job.name));

    this.maintenanceQueue = new Queue(JobQueues.maintenance, { connection });
    for (const [name, every] of Object.entries(SCHEDULE)) {
      await this.maintenanceQueue.upsertJobScheduler(
        name,
        { every },
        {
          name,
          opts: { removeOnComplete: 100, removeOnFail: 500 },
        },
      );
    }
    this.logger.log('Jobs service started');
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await this.maintenanceQueue?.close();
  }
}
