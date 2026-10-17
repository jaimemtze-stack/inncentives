import { z } from 'zod';
import { FileSecretsProvider } from './secrets';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Host names may carry a port in development (e.g. soporte.localhost:8080). */
const hostSchema = z
  .string()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+(:\d{2,5})?$/);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SECRETS_DIR: z.string().default('/run/secrets'),
  PUBLIC_SCHEME: z.enum(['https', 'http']).default('https'),
  PORTAL_HOST: hostSchema,
  AGENT_HOST: hostSchema,
  /** Fastify trustProxy: comma-separated CIDRs/IPs of the reverse proxies. */
  TRUST_PROXY: z.string().default('127.0.0.1,::1'),
  /** Use CF-Connecting-IP as the client address (only behind Cloudflare Tunnel). */
  TRUST_CF_CONNECTING_IP: bool.default('false'),
  COOKIE_SECURE: bool.default('true'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(24).default(12),
  REAUTH_WINDOW_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(72),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
  PWNED_PASSWORDS_CHECK: bool.default('true'),
  PWNED_PASSWORDS_URL: z.string().url().default('https://api.pwnedpasswords.com/range/'),
  STORAGE_DRIVER: z.enum(['s3', 'oci']).default('s3'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET_ATTACHMENTS: z.string().default('adjuntos'),
  S3_FORCE_PATH_STYLE: bool.default('true'),
  OCI_REGION: z.string().default('mx-queretaro-1'),
  OCI_NAMESPACE: z.string().optional(),
  OCI_BUCKET_ATTACHMENTS: z.string().default('adjuntos'),
  APP_NAME: z.string().default('Soporte Inncentives'),
});

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig extends Env {
  databaseUrl: string;
  redisUrl: string;
  /** First key is the active one; the rest are kept to decrypt older data. */
  fieldEncryptionKeys: { id: string; key: Buffer }[];
  s3Credentials?: { accessKeyId: string; secretAccessKey: string };
  trustProxy: string[];
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function parseFieldKeys(raw: string): { id: string; key: Buffer }[] {
  const keys = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, b64] = entry.split(':');
      if (!id || !b64 || !/^[a-z0-9]{1,16}$/.test(id)) {
        throw new Error('field_encryption_keys must look like "k1:<base64 32 bytes>[,k0:...]"');
      }
      const key = Buffer.from(b64, 'base64');
      if (key.length !== 32) throw new Error(`Field encryption key ${id} must be 32 bytes`);
      return { id, key };
    });
  if (keys.length === 0) throw new Error('At least one field encryption key is required');
  return keys;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  if (e.PORTAL_HOST === e.AGENT_HOST) {
    throw new Error('PORTAL_HOST and AGENT_HOST must be different hosts');
  }
  if (e.NODE_ENV === 'production') {
    if (!e.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (e.PUBLIC_SCHEME !== 'https') throw new Error('PUBLIC_SCHEME must be https in production');
  }
  const secrets = new FileSecretsProvider(e.SECRETS_DIR, e.NODE_ENV !== 'production', env);
  const s3Key = secrets.get('s3_access_key_id');
  const s3Secret = secrets.get('s3_secret_access_key');
  return {
    ...e,
    databaseUrl: secrets.require('database_url'),
    redisUrl: secrets.require('redis_url'),
    fieldEncryptionKeys: parseFieldKeys(secrets.require('field_encryption_keys')),
    s3Credentials:
      s3Key && s3Secret ? { accessKeyId: s3Key, secretAccessKey: s3Secret } : undefined,
    trustProxy: e.TRUST_PROXY.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
