import { Worker, type ConnectionOptions } from 'bullmq';
import pino from 'pino';
import { z } from 'zod';
import {
  GraphAdapter,
  SmtpAdapter,
  graphTokenFromAzureIdentity,
  type OutboundMailAdapter,
} from './mail/adapters';
import { createTransactionalProcessor } from './mail/transactional.processor';
import { QUEUES } from './queues/names';

const env = z
  .object({
    REDIS_URL: z.string().default('redis://localhost:6379'),
    MAIL_ADAPTER: z.enum(['smtp', 'graph']).default('smtp'),
    MAIL_FROM: z.string().default('Soporte Inncentives <soporte@localhost>'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().default(1025),
    SMTP_SECURE: z.enum(['true', 'false']).default('false'),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    GRAPH_MAILBOX: z.string().optional(),
    PRODUCT_NAME: z.string().default('Soporte Inncentives'),
    LOG_LEVEL: z.string().default('info'),
  })
  .parse(process.env);

const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'inn-support-worker' },
  redact: { paths: ['*.to', '*.vars', '*.html', '*.text', 'to', 'vars'], censor: '[REDACTED]' },
});

async function createAdapter(): Promise<OutboundMailAdapter> {
  if (env.MAIL_ADAPTER === 'graph') {
    if (!env.GRAPH_MAILBOX) throw new Error('GRAPH_MAILBOX is required for MAIL_ADAPTER=graph');
    return new GraphAdapter(env.GRAPH_MAILBOX, await graphTokenFromAzureIdentity());
  }
  return new SmtpAdapter({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  });
}

async function main() {
  const url = new URL(env.REDIS_URL);
  const connection: ConnectionOptions = {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
  };
  const processMail = createTransactionalProcessor(
    await createAdapter(),
    env.MAIL_FROM,
    env.PRODUCT_NAME,
  );

  const workers = [
    new Worker(QUEUES.mailTransactional, (job) => processMail(job.data), {
      connection,
      concurrency: 5,
    }),
  ];
  for (const w of workers) {
    w.on('completed', (job) =>
      logger.info({ queue: w.name, jobId: job.id, template: job.name }, 'job completed'),
    );
    w.on('failed', (job, err) =>
      logger.warn(
        { queue: w.name, jobId: job?.id, attempts: job?.attemptsMade, error: err.message },
        'job failed',
      ),
    );
  }
  logger.info({ queues: workers.map((w) => w.name) }, 'worker started');

  const shutdown = async () => {
    logger.info('shutting down');
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  logger.fatal(
    { error: err instanceof Error ? err.message : String(err) },
    'worker failed to start',
  );
  process.exit(1);
});
