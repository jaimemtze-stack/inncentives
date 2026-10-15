import { Injectable } from '@nestjs/common';
import type { GroupAccessLevel } from '@inn/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from './actor';

@Injectable()
export class ActorLoaderService {
  constructor(private readonly prisma: PrismaService) {}

  /** Loads an active user with roles, permissions, organizations and group access. */
  async load(userId: string): Promise<Actor | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: true } },
        groupAccess: { include: { group: { select: { active: true } } } },
        secondaryOrganizations: { select: { organizationId: true } },
      },
    });
    if (!user || user.status !== 'active') return null;
    const activeRoles = user.roles.map((r) => r.role).filter((r) => r.active);
    return {
      userId: user.id,
      email: user.email,
      roles: activeRoles.map((r) => r.name),
      permissions: new Set(activeRoles.flatMap((r) => r.permissions)),
      organizationIds: [
        ...(user.organizationId ? [user.organizationId] : []),
        ...user.secondaryOrganizations.map((o) => o.organizationId),
      ],
      sharedOrganization: user.sharedOrganization,
      groupLevels: new Map(
        user.groupAccess
          .filter((g) => g.group.active)
          .map((g) => [g.groupId, g.levels as GroupAccessLevel[]]),
      ),
      locale: user.locale,
    };
  }
}
