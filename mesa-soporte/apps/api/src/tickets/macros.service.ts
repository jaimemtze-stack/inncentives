import { Injectable } from '@nestjs/common';
import { ActionsSchema, type BulkUpdateInput } from '@mesa/shared';
import { AppError } from '../common/errors';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { TicketAccessService } from './access.service';
import { TicketService } from './ticket.service';

/** Macros (one-click action sets) and bulk changes from ticket lists. */
@Injectable()
export class MacrosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
    private readonly tickets: TicketService,
  ) {}

  async apply(actor: AuthenticatedUser, ticketId: string, macroId: string): Promise<void> {
    const ticket = await this.access.load(actor, ticketId, 'change');
    const macro = await this.prisma.macro.findFirst({ where: { id: macroId, active: true } });
    if (!macro || (macro.groupIds.length && !macro.groupIds.includes(ticket.groupId)))
      throw new AppError('not_found');
    const actions = ActionsSchema.safeParse(macro.actions);
    if (!actions.success) throw new AppError('internal_error', 'Invalid macro definition.');
    await this.tickets.applyActions(ticketId, actions.data, { actorId: actor.id, actor });
  }

  /** Applies the same change to many tickets; each one is authorised on its own. */
  async bulk(actor: AuthenticatedUser, input: BulkUpdateInput) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of new Set(input.ids)) {
      try {
        if (input.changes && Object.keys(input.changes).length)
          await this.tickets.updateByUser(actor, id, input.changes);
        if (input.addTags?.length) {
          await this.access.load(actor, id, 'change');
          await this.tickets.changeTags(id, input.addTags, [], actor.id);
        }
        if (input.macroId) await this.apply(actor, id, input.macroId);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({
          id,
          ok: false,
          error: err instanceof AppError ? err.code : 'internal_error',
        });
      }
    }
    return { results };
  }
}
