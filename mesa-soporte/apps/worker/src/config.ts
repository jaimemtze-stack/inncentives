import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SECRETS_DIR: z.string().default('/run/secrets'),
  MAIL_TRANSPORT: z.enum(['smtp', 'log']).default('smtp'),
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
};

function readSecret(dir: string, name: string, allowEnv: boolean): string | undefined {
  const path = join(dir, name);
  try {
    if ((statSync(path).mode & 0o004) !== 0) throw new Error(`Secret ${path} is world-readable`);
    return readFileSync(path, 'utf8').replace(/\r?\n$/, '');
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
  const user = readSecret(env.SECRETS_DIR, 'smtp_username', allowEnv);
  const pass = readSecret(env.SECRETS_DIR, 'smtp_password', allowEnv);
  return { ...env, redisUrl, smtpAuth: user && pass ? { user, pass } : undefined };
}
