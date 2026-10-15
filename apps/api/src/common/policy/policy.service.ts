import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hasPermission, levelGrants, type GroupAccessLevel } from '@inn/shared';
import type { Prisma } from '@prisma/client';
import type { Actor } from '../auth/actor';

/**
 * Single source of truth for object-level authorization (ADR-0002).
 * Every channel that reads tickets (views, search, reports, exports, attachments,
 * realtime, webhooks) must build its query with `ticketScope`.
 */
@Injectable()
export class PolicyService {
  /** Groups where the agent holds `level`. */
  agentGroupIds(actor: Actor, level: GroupAccessLevel): string[] {
    if (!hasPermission(actor.permissions, 'ticket.agent')) return [];
    return [...actor.groupLevels.entries()]
      .filter(([, levels]) => levelGrants(levels, level))
      .map(([g]) => g);
  }

  /** Prisma filter of tickets the actor may access with the given level. Denies by default. */
  ticketScope(actor: Actor, level: GroupAccessLevel = 'read'): Prisma.TicketWhereInput {
    const or: Prisma.TicketWhereInput[] = [];
    const groups = this.agentGroupIds(actor, level);
    if (groups.length) or.push({ groupId: { in: groups } });

    if (hasPermission(actor.permissions, 'ticket.customer') && level !== 'overview') {
      or.push({ customerId: actor.userId });
      if (actor.sharedOrganization && actor.organizationIds.length) {
        or.push({ organizationId: { in: actor.organizationIds } });
      }
    }
    // An empty OR in Prisma matches nothing — explicit deny.
    return { OR: or.length ? or : [{ id: { in: [] } }] };
  }

  /** In-memory check for an already loaded ticket. */
  canAccessTicket(
    actor: Actor,
    ticket: { groupId: string; customerId: string; organizationId: string | null },
    level: GroupAccessLevel = 'read',
  ): boolean {
    if (this.agentGroupIds(actor, level).includes(ticket.groupId)) return true;
    if (hasPermission(actor.permissions, 'ticket.customer') && level !== 'overview') {
      if (ticket.customerId === actor.userId) return true;
      if (
        actor.sharedOrganization &&
        ticket.organizationId &&
        actor.organizationIds.includes(ticket.organizationId)
      ) {
        return true;
      }
    }
    return false;
  }

  /** Whether the actor sees the ticket as an agent (internal articles, time accounting…). */
  isAgentFor(actor: Actor, ticket: { groupId: string }): boolean {
    return this.agentGroupIds(actor, 'read').includes(ticket.groupId);
  }

  /**
   * Throws 404 (not 403) when the actor cannot see the object at all, so existence is not leaked;
   * 403 when it can read but not perform the requested level.
   */
  assertTicket(
    actor: Actor,
    ticket: { groupId: string; customerId: string; organizationId: string | null } | null,
    level: GroupAccessLevel = 'read',
  ): asserts ticket is NonNullable<typeof ticket> {
    if (!ticket || !this.canAccessTicket(actor, ticket, 'read')) throw new NotFoundException();
    if (level !== 'read' && !this.canAccessTicket(actor, ticket, level))
      throw new ForbiddenException();
  }
}
