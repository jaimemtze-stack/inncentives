import { createApp } from './bootstrap';
import { loadConfig } from './config/config';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('Fatal error during startup', err instanceof Error ? err.message : err);
  process.exit(1);
});
