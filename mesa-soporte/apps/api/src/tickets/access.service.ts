import { Injectable } from '@nestjs/common';
import { Permission } from '@mesa/shared';
import type { Prisma } from '@prisma/client';
import { AppError } from '../common/errors';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

/** What the actor wants to do with tickets of a group. */
export type TicketAccess = 'read' | 'overview' | 'change' | 'create';

/** Group access levels that grant each kind of access (Zammad semantics). */
const LEVELS: Record<TicketAccess, string[]> = {
  read: ['full', 'read', 'change'],
  overview: ['full', 'read', 'change', 'overview'],
  change: ['full', 'change'],
  create: ['full', 'create'],
};

/**
 * Object-level authorization for tickets. Every ticket query goes through
 * scope(); single-ticket loads use load(), which answers "not found" for
 * tickets outside the scope so ticket ids cannot be probed.
 */
@Injectable()
export class TicketAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isStaff(actor: AuthenticatedUser): boolean {
    return actor.permissions.includes(Permission.TicketsAgent);
  }

  /** Groups the agent holds `access` on; 'all' for administrators. */
  async groupIds(actor: AuthenticatedUser, access: TicketAccess): Promise<string[] | 'all'> {
    if (actor.role === 'ADMIN') return 'all';
    if (!this.isStaff(actor)) return [];
    const rows = await this.prisma.groupAccess.findMany({
      where: { userId: actor.id, levels: { hasSome: LEVELS[access] } },
      select: { groupId: true },
    });
    return rows.map((r) => r.groupId);
  }

  async canInGroup(
    actor: AuthenticatedUser,
    groupId: string,
    access: TicketAccess,
  ): Promise<boolean> {
    const ids = await this.groupIds(actor, access);
    return ids === 'all' || ids.includes(groupId);
  }

  async customerOrganizations(actor: AuthenticatedUser): Promise<string[] | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { orgTicketAccess: true, organizationId: true, secondaryOrganizations: true },
    });
    if (!u?.orgTicketAccess) return null;
    return [u.organizationId, ...u.secondaryOrganizations.map((s) => s.organizationId)];
  }

  async scope(actor: AuthenticatedUser, access: TicketAccess): Promise<Prisma.TicketWhereInput> {
    if (this.isStaff(actor)) {
      const ids = await this.groupIds(actor, access);
      if (ids === 'all') return {};
      const or: Prisma.TicketWhereInput[] = [{ groupId: { in: ids } }];
      // Owners keep working on their tickets even without group access.
      if (access === 'read' || access === 'change') or.push({ ownerId: actor.id });
      return { OR: or };
    }
    if (actor.permissions.includes(Permission.TicketsCustomer)) {
      const orgs = await this.customerOrganizations(actor);
      const base: Prisma.TicketWhereInput = orgs
        ? { OR: [{ customerId: actor.id }, { organizationId: { in: orgs } }] }
        : { customerId: actor.id };
      // Customers never see tickets waiting in triage or merged away.
      return { AND: [base, { state: { not: 'merged' } }] };
    }
    return { id: { in: [] } };
  }

  /** Loads a ticket the actor may access, or fails with not_found / forbidden. */
  async load<T extends Prisma.TicketInclude | undefined = undefined>(
    actor: AuthenticatedUser,
    id: string,
    access: 'read' | 'change',
    include?: T,
  ) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { AND: [{ id }, await this.scope(actor, 'read')] },
      include,
    });
    if (!ticket) throw new AppError('not_found');
    if (access === 'change' && this.isStaff(actor)) {
      const ok =
        ticket.ownerId === actor.id || (await this.canInGroup(actor, ticket.groupId, 'change'));
      if (!ok) throw new AppError('forbidden');
    }
    return ticket as Prisma.TicketGetPayload<{ include: T }>;
  }
}
