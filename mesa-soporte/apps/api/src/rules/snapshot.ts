import type { Ticket } from '@prisma/client';
import type { TicketSnapshot } from './conditions';

export type TicketWithTags = Ticket & { tags: Array<{ name: string }> };

export function ticketSnapshot(t: TicketWithTags): TicketSnapshot {
  return {
    number: t.number,
    title: t.title,
    state: t.state,
    priorityId: t.priorityId,
    groupId: t.groupId,
    ownerId: t.ownerId,
    customerId: t.customerId,
    organizationId: t.organizationId,
    tags: t.tags.map((x) => x.name),
    channel: t.channel,
    pendingUntil: t.pendingUntil,
    escalationAt: t.escalationAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastCustomerContactAt: t.lastCustomerContactAt,
    sensitiveData: t.sensitiveData,
    customFields: (t.customFields ?? {}) as Record<string, unknown>,
  };
}
