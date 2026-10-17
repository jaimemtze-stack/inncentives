import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createRootLogger, PinoNestLogger } from './common/logger';
import { loadConfig } from './config/config';
import { JobsModule } from './jobs/jobs.module';

/** Entry point of the jobs service: queues and periodic tasks, no HTTP. */
async function main() {
  const config = loadConfig();
  const logger = createRootLogger(config.LOG_LEVEL);
  const app = await NestFactory.createApplicationContext(JobsModule.forRoot(config), {
    logger: new PinoNestLogger(logger),
  });
  app.enableShutdownHooks();
}

void main().catch((err: unknown) => {
  console.error('Jobs service failed to start', err instanceof Error ? err.message : err);
  process.exit(1);
});
