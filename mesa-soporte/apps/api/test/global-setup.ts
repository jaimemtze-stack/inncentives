import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import './setup-env';

/**
 * Each run creates its own throw-away database (never touches an existing
 * one), applies the migrations with the non-destructive `migrate deploy`, and
 * drops only that database at the end.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const base = new URL(
    process.env.TEST_DATABASE_SERVER_URL ??
      'postgresql://mesa:mesa_dev_pw@127.0.0.1:55432/postgres',
  );
  const dbName = `mesa_test_${Date.now()}_${randomBytes(3).toString('hex')}`;
  if (!/^mesa_test_[0-9]+_[0-9a-f]{6}$/.test(dbName)) throw new Error('unexpected db name');

  const admin = new PrismaClient({ datasources: { db: { url: base.toString() } } });
  await admin.$executeRaw(Prisma.raw(`CREATE DATABASE "${dbName}"`));

  const testUrl = new URL(base.toString());
  testUrl.pathname = `/${dbName}`;
  process.env.SECRET_DATABASE_URL = testUrl.toString();
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: 'pipe',
  });

  const redis = new Redis(process.env.SECRET_REDIS_URL as string);
  await redis.flushdb(); // dedicated Redis DB index for tests (see setup-env)
  await redis.quit();

  return async () => {
    await admin.$executeRaw(Prisma.raw(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`));
    await admin.$disconnect();
  };
}
