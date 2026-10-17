import { EmailSchema } from '@mesa/shared';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { newToken, sha256Hex } from '../security/tokens';

const InputSchema = z.object({
  email: EmailSchema,
  name: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().min(1).max(160).default('Neitek'),
  ttlHours: z.number().int().min(1).max(72).default(24),
});

/**
 * Creates the invitation for the FIRST administrator. Refuses to run once any
 * administrator exists, so it cannot be used to plant a second admin later.
 * Returns the one-time token; the caller prints the link once.
 */
export async function bootstrapFirstAdmin(
  prisma: PrismaClient | PrismaService,
  raw: z.input<typeof InputSchema>,
): Promise<{ token: string; invitationId: string }> {
  const input = InputSchema.parse(raw);
  if ((await prisma.user.count({ where: { role: 'ADMIN' } })) > 0) {
    throw new Error('An administrator already exists; invite new admins from the application.');
  }
  const token = newToken();
  const audit = new AuditService(prisma as PrismaService);
  const invitation = await prisma.$transaction(async (tx) => {
    const org =
      (await tx.organization.findFirst({ where: { isInternal: true } })) ??
      (await tx.organization.create({ data: { name: input.organizationName, isInternal: true } }));
    // Supersede any earlier, unused bootstrap invitation.
    await tx.invitation.updateMany({
      where: { role: 'ADMIN', acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Invitations need an inviter: a disabled "system" account that can never
    // sign in (status DISABLED and an unusable password hash).
    const system =
      (await tx.user.findFirst({ where: { email: 'system@mesa.invalid' } })) ??
      (await tx.user.create({
        data: {
          email: 'system@mesa.invalid',
          name: 'Sistema',
          role: 'AGENT',
          status: 'DISABLED',
          organizationId: org.id,
          passwordHash: '!disabled',
        },
      }));
    const inv = await tx.invitation.create({
      data: {
        tokenHash: sha256Hex(token),
        email: input.email,
        name: input.name,
        role: 'ADMIN',
        organizationId: org.id,
        invitedById: system.id,
        expiresAt: new Date(Date.now() + input.ttlHours * 3_600_000),
      },
    });
    await audit.record(
      {
        actorType: 'system',
        action: 'bootstrap.first_admin_invited',
        targetType: 'invitation',
        targetId: inv.id,
        organizationId: org.id,
        data: { email: input.email },
      },
      tx,
    );
    return inv;
  });
  return { token, invitationId: invitation.id };
}
