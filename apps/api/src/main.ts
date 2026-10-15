import { createApp } from './app.factory';
import { loadConfig } from './config/config';
import { createLogger } from './common/logger';

async function main() {
  const config = await loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const app = await createApp(config, { logger });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT }, 'api listening');
}

main().catch((err: unknown) => {
  createLogger('error').fatal(
    { err: err instanceof Error ? err.message : String(err) },
    'startup failed',
  );
  process.exit(1);
});
