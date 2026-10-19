import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SECRETS_DIR: z.string().default('/run/secrets'),
  MAIL_TRANSPORT: z.enum(['smtp', 'graph', 'log']).default('smtp'),
  /** Microsoft Graph transport (system mail without SMTP AUTH). */
  GRAPH_TENANT_ID: z.string().optional(),
  GRAPH_CLIENT_ID: z.string().optional(),
  GRAPH_SENDER: z.string().email().optional(),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(587),
  /** "starttls" is required in production; "none" only for local Mailpit. */
  SMTP_TLS: z.enum(['implicit', 'starttls', 'none']).default('starttls'),
  MAIL_FROM: z.string().default('Soporte Inncentives <soporte@example.com>'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),
});

export type WorkerConfig = z.infer<typeof EnvSchema> & {
  redisUrl: string;
  smtpAuth?: { user: string; pass: string };
  graph?: { tenantId: string; clientId: string; clientSecret: string; sender: string };
};

function readSecret(dir: string, name: string, allowEnv: boolean): string | undefined {
  const path = join(dir, name);
  try {
    if ((statSync(path).mode & 0o004) !== 0) throw new Error(`Secret ${path} is world-readable`);
    const value = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
    // Placeholder written by the bootstrap for credentials not set up yet.
    return value === 'unused' || value === '' ? undefined : value;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return allowEnv ? process.env[`SECRET_${name.toUpperCase()}`] : undefined;
}

export function loadWorkerConfig(): WorkerConfig {
  const env = EnvSchema.parse(process.env);
  if (env.NODE_ENV === 'production' && env.SMTP_TLS === 'none' && env.MAIL_TRANSPORT === 'smtp') {
    throw new Error('SMTP_TLS=none is not allowed in production');
  }
  const allowEnv = env.NODE_ENV !== 'production';
  const redisUrl = readSecret(env.SECRETS_DIR, 'redis_url', allowEnv);
  if (!redisUrl) throw new Error('Missing required secret: redis_url');
  if (env.MAIL_TRANSPORT === 'graph') {
    const clientSecret = readSecret(env.SECRETS_DIR, 'graph_client_secret', allowEnv);
    if (!env.GRAPH_TENANT_ID || !env.GRAPH_CLIENT_ID || !env.GRAPH_SENDER || !clientSecret)
      throw new Error(
        'MAIL_TRANSPORT=graph needs GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_SENDER and the graph_client_secret secret',
      );
    return {
      ...env,
      redisUrl,
      graph: {
        tenantId: env.GRAPH_TENANT_ID,
        clientId: env.GRAPH_CLIENT_ID,
        clientSecret,
        sender: env.GRAPH_SENDER,
      },
    };
  }
  const user = readSecret(env.SECRETS_DIR, 'smtp_username', allowEnv);
  const pass = readSecret(env.SECRETS_DIR, 'smtp_password', allowEnv);
  return { ...env, redisUrl, smtpAuth: user && pass ? { user, pass } : undefined };
}
