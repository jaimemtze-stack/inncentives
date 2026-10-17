/**
 * Demo data for development. Refuses to run in production.
 *   pnpm --filter @mesa/api db:seed
 */
import { randomBytes } from 'node:crypto';
import { Algorithm, hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../config/config';

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') throw new Error('The demo seed never runs in production.');
  const prisma = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  const password = process.env.SEED_PASSWORD ?? randomBytes(12).toString('base64url');
  const passwordHash = await hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const neitek =
    (await prisma.organization.findFirst({ where: { isInternal: true } })) ??
    (await prisma.organization.create({
      data: { name: 'Neitek', isInternal: true, domains: ['neitek.com'] },
    }));
  const acme =
    (await prisma.organization.findFirst({ where: { name: 'ACME Demo' } })) ??
    (await prisma.organization.create({ data: { name: 'ACME Demo', domains: ['acme.example'] } }));

  const users = [
    {
      email: 'admin@neitek.example',
      name: 'Admin Demo',
      role: 'ADMIN' as const,
      organizationId: neitek.id,
    },
    {
      email: 'agente@neitek.example',
      name: 'Agente Demo',
      role: 'AGENT' as const,
      organizationId: neitek.id,
    },
    {
      email: 'cliente@acme.example',
      name: 'Cliente Demo',
      role: 'CUSTOMER' as const,
      organizationId: acme.id,
    },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash },
    });
  }
  await prisma.$disconnect();
  console.log(`Seed listo. Usuarios: ${users.map((u) => u.email).join(', ')}`);
  if (!process.env.SEED_PASSWORD)
    console.log(`Contraseña generada para los usuarios demo: ${password}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
