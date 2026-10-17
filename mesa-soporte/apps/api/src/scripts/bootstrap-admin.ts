/**
 * First administrator, in production:
 *   docker compose run --rm api dist/scripts/bootstrap-admin.js admin@neitek.com "Nombre Apellido"
 * Prints a one-time invitation link (valid 24 h) to the operator's terminal.
 */
import { PrismaClient } from '@prisma/client';
import { bootstrapFirstAdmin } from '../admin/bootstrap';
import { loadConfig } from '../config/config';

async function main(): Promise<void> {
  const [email, name] = process.argv.slice(2);
  if (!email || !name) throw new Error('usage: bootstrap-admin <email> "<name>"');
  const config = loadConfig();
  const prisma = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  try {
    const { token } = await bootstrapFirstAdmin(prisma, { email, name });
    process.stdout.write(
      `Invitación creada. Ábrela en las próximas 24 h (un solo uso):\n` +
        `${config.PUBLIC_SCHEME}://${config.AGENT_HOST}/invitacion#token=${token}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
