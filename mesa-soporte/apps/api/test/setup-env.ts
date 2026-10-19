// Integration tests run against real PostgreSQL and Redis. CI provides them as
// services; locally `docker compose up postgres redis` does.
import { randomBytes } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.PORTAL_HOST ??= 'soporte.test';
process.env.AGENT_HOST ??= 'agentes.soporte.test';
process.env.PUBLIC_SCHEME ??= 'https';
process.env.SECRETS_DIR ??= '/nonexistent';
process.env.PWNED_PASSWORDS_CHECK ??= 'false';
process.env.LOG_LEVEL ??= 'warn';
// The database URL is set by global-setup (a fresh database per run).
process.env.SECRET_REDIS_URL ??= 'redis://127.0.0.1:56379/15';
process.env.SECRET_FIELD_ENCRYPTION_KEYS ??= `k1:${randomBytes(32).toString('base64')}`;
// Attachments go to the S3-compatible dev store (SeaweedFS locally, a service in CI).
process.env.S3_ENDPOINT ??= process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:8333';
process.env.SECRET_S3_ACCESS_KEY_ID ??= process.env.TEST_S3_KEY ?? 'devkey';
process.env.SECRET_S3_SECRET_ACCESS_KEY ??= process.env.TEST_S3_SECRET ?? 'devsecret123';
process.env.S3_BUCKET_ATTACHMENTS ??= 'test-adjuntos';
