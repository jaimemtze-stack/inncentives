/**
 * Demo data (fictitious). Never load real customer data.
 * Usage: pnpm --filter @inn/api seed   (requires SEED_DEMO_PASSWORD)
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { seedBase } from '../src/seed/base';

async function main() {
  const prisma = new PrismaClient();
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 12)
    throw new Error('SEED_DEMO_PASSWORD (12+ chars) is required');
  if (process.env.NODE_ENV === 'production')
    throw new Error('Demo seed is not allowed in production');

  await seedBase(prisma);
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const role = (name: string) => prisma.role.findUniqueOrThrow({ where: { name } });
  const plan = await prisma.supportPlan.findUniqueOrThrow({ where: { name: 'Estándar' } });

  const acme = await prisma.organization.upsert({
    where: { name: 'ACME Incentivos (demo)' },
    update: {},
    create: { name: 'ACME Incentivos (demo)', domains: ['acme.test'], supportPlanId: plan.id },
  });
  await prisma.organization.upsert({
    where: { name: 'Globex Comercial (demo)' },
    update: {},
    create: { name: 'Globex Comercial (demo)', domains: ['globex.test'], supportPlanId: plan.id },
  });

  const users: Array<{
    email: string;
    firstname: string;
    lastname: string;
    roles: string[];
    organizationId?: string;
  }> = [
    {
      email: 'admin@demo.inncentives.test',
      firstname: 'Ada',
      lastname: 'Admin',
      roles: ['admin', 'agent'],
    },
    {
      email: 'agente1@demo.inncentives.test',
      firstname: 'Néstor',
      lastname: 'Nivel Uno',
      roles: ['agent'],
    },
    {
      email: 'agente2@demo.inncentives.test',
      firstname: 'Diana',
      lastname: 'Nivel Dos',
      roles: ['agent'],
    },
    {
      email: 'cliente@acme.test',
      firstname: 'Carla',
      lastname: 'Cliente',
      roles: ['customer'],
      organizationId: acme.id,
    },
  ];
  const groups = await prisma.group.findMany();
  for (const u of users) {
    const roles = await Promise.all(u.roles.map(role));
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        firstname: u.firstname,
        lastname: u.lastname,
        status: 'active',
        passwordHash: hash,
        organizationId: u.organizationId ?? null,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
    });
    if (u.roles.includes('agent')) {
      for (const g of groups) {
        await prisma.groupAccess.upsert({
          where: { userId_groupId: { userId: user.id, groupId: g.id } },
          update: {},
          create: { userId: user.id, groupId: g.id, levels: ['full'] },
        });
      }
    }
  }
  await prisma.$disconnect();
  console.log('Demo seed complete');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
