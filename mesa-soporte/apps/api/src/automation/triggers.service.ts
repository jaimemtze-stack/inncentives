import { Injectable } from '@nestjs/common';
import { ActionsSchema, ConditionSchema, type RuleAction } from '@mesa/shared';
import { PrismaService } from '../prisma/prisma.service';
import { evaluate, type RuleContext } from '../rules/conditions';

export interface MatchedTrigger {
  id: string;
  name: string;
  actions: RuleAction[];
}

/** Selects the active triggers of an event whose conditions match. */
@Injectable()
export class TriggersService {
  constructor(private readonly prisma: PrismaService) {}

  async matching(event: 'create' | 'update', ctx: RuleContext): Promise<MatchedTrigger[]> {
    const rows = await this.prisma.trigger.findMany({
      where: { active: true, event: { in: [event, 'create_or_update'] } },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    const out: MatchedTrigger[] = [];
    for (const t of rows) {
      const cond = ConditionSchema.safeParse(t.conditions);
      const actions = ActionsSchema.safeParse(t.actions);
      if (cond.success && actions.success && evaluate(cond.data, ctx)) {
        out.push({ id: t.id, name: t.name, actions: actions.data });
      }
    }
    return out;
  }
}
