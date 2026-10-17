import { MAIL_QUEUE, type MailJob } from '@mesa/shared';
import { Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import pino from 'pino';
import { loadWorkerConfig } from './config';
import { render } from './templates';

const config = loadWorkerConfig();
const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'mesa-worker' },
  redact: { paths: ['*.link', '*.params', 'to'], censor: '[redacted]' },
});

const transport =
  config.MAIL_TRANSPORT === 'log'
    ? null
    : nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_TLS === 'implicit',
        requireTLS: config.SMTP_TLS === 'starttls',
        ignoreTLS: config.SMTP_TLS === 'none',
        tls: { minVersion: 'TLSv1.2' },
        auth: config.smtpAuth,
      });

const url = new URL(config.redisUrl);
const worker = new Worker<MailJob>(
  MAIL_QUEUE,
  async (job) => {
    const mail = render(job.data);
    if (!transport) {
      logger.info(
        { jobId: job.id, template: job.data.template },
        'Mail transport "log": message not sent',
      );
      return;
    }
    await transport.sendMail({
      from: config.MAIL_FROM,
      to: job.data.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    logger.info({ jobId: job.id, template: job.data.template }, 'Mail sent');
  },
  {
    connection: {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
    },
    concurrency: config.WORKER_CONCURRENCY,
  },
);

worker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, template: job?.data.template, err: err.message },
    'Mail job failed',
  );
});

const shutdown = async () => {
  await worker.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
logger.info('Worker started');
