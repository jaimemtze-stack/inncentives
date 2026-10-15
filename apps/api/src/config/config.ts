import { z } from 'zod';
import { createSecretsProvider, type SecretsProvider } from './secrets';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORTAL_HOST: z.string().min(1).default('localhost'),
  AGENT_HOST: z.string().min(1).default('agents.localhost'),
  /** Public base URLs used in e-mails (invitation and reset links). */
  PORTAL_URL: z.string().url().default('http://localhost:5173'),
  AGENT_URL: z.string().url().default('http://agents.localhost:5173'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  COOKIE_SECURE: bool.default('true'),
  TRUST_CLOUDFLARE: bool.default('false'),
  SESSION_IDLE_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  REAUTH_MAX_AGE_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
  INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  HIBP_ENABLED: bool.default('true'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(300),
  BODY_LIMIT_BYTES: z.coerce.number().int().default(1_048_576),
  TICKET_SUBJECT_PREFIX: z.string().default('Ticket#'),
  TIMEZONE: z.string().default('America/Mexico_City'),
  PRODUCT_NAME: z.string().default('Soporte Inncentives'),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig extends Env {
  databaseUrl: string;
  /** 32-byte keys, base64. The first key encrypts; all keys decrypt (rotation). */
  fieldEncryptionKeys: Buffer[];
  /** HMAC key for CSRF tokens. */
  csrfSecret: Buffer;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

function decodeKey(name: string, b64: string): Buffer {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes encoded in base64`);
  return key;
}

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  secrets: SecretsProvider = createSecretsProvider(env),
): Promise<AppConfig> {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  const databaseUrl = await secrets.get('DATABASE_URL');
  const fieldKeys = await secrets.get('FIELD_ENCRYPTION_KEYS');
  const csrf = await secrets.get('CSRF_SECRET');
  const missing = [
    !databaseUrl && 'DATABASE_URL',
    !fieldKeys && 'FIELD_ENCRYPTION_KEYS',
    !csrf && 'CSRF_SECRET',
  ].filter(Boolean);
  if (missing.length) throw new Error(`Missing secrets: ${missing.join(', ')}`);

  const cfg: AppConfig = {
    ...parsed.data,
    databaseUrl: databaseUrl!,
    fieldEncryptionKeys: fieldKeys!
      .split(',')
      .map((k, i) => decodeKey(`FIELD_ENCRYPTION_KEYS[${i}]`, k.trim())),
    csrfSecret: decodeKey('CSRF_SECRET', csrf!),
  };
  if (cfg.NODE_ENV === 'production' && !cfg.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE=false is not allowed in production');
  }
  return cfg;
}
