/**
 * Creates or drops a throw-away database for browser tests.
 *   tsx src/scripts/e2e-db.ts create   -> prints the new DATABASE_URL
 *   tsx src/scripts/e2e-db.ts drop <url>
 * Only names matching mesa_e2e_<digits>_<hex> are ever dropped.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const NAME = /^mesa_e2e_[0-9]+_[0-9a-f]{6}$/;

async function main(): Promise<void> {
  const server = new URL(
    process.env.TEST_DATABASE_SERVER_URL ??
      'postgresql://mesa:mesa_dev_pw@127.0.0.1:55432/postgres',
  );
  const admin = new PrismaClient({ datasources: { db: { url: server.toString() } } });
  try {
    if (process.argv[2] === 'create') {
      const name = `mesa_e2e_${Date.now()}_${randomBytes(3).toString('hex')}`;
      await admin.$executeRaw(Prisma.raw(`CREATE DATABASE "${name}"`));
      const url = new URL(server.toString());
      url.pathname = `/${name}`;
      execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: 'ignore',
      });
      process.stdout.write(url.toString());
    } else if (process.argv[2] === 'drop') {
      const name = new URL(process.argv[3] ?? '').pathname.slice(1);
      if (!NAME.test(name)) throw new Error(`Refusing to drop ${name}`);
      await admin.$executeRaw(Prisma.raw(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    } else {
      throw new Error('usage: e2e-db.ts create | drop <url>');
    }
  } finally {
    await admin.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
