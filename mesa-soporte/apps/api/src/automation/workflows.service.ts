import { Injectable } from '@nestjs/common';
import {
  ConditionSchema,
  WorkflowActionsSchema,
  type WorkflowFieldEffect,
  type WorkflowScreen,
} from '@mesa/shared';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { evaluate, type RuleContext, type TicketSnapshot } from '../rules/conditions';

export type FormEffects = Record<string, WorkflowFieldEffect>;

function fieldValue(t: TicketSnapshot, field: string): unknown {
  if (field.startsWith('custom.')) return t.customFields[field.slice(7)];
  switch (field) {
    case 'title':
      return t.title;
    case 'state':
      return t.state;
    case 'priority_id':
      return t.priorityId;
    case 'group_id':
      return t.groupId;
    case 'owner_id':
      return t.ownerId;
    case 'pending_until':
      return t.pendingUntil;
    default:
      return undefined;
  }
}

const empty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Core workflows: dynamic form rules (show/hide, mandatory, read-only,
 * restricted options). The web form asks evaluate() for hints, and every
 * create/update is checked again here with enforce(), so the rules cannot be
 * bypassed by calling the API directly.
 */
@Injectable()
export class WorkflowsService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(screen: WorkflowScreen, ctx: RuleContext): Promise<FormEffects> {
    const rows = await this.prisma.coreWorkflow.findMany({
      where: { active: true, screens: { has: screen } },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    const effects: FormEffects = {};
    for (const wf of rows) {
      const cond = ConditionSchema.safeParse(wf.conditions);
      const actions = WorkflowActionsSchema.safeParse(wf.actions);
      if (!cond.success || !actions.success || !evaluate(cond.data, ctx)) continue;
      for (const [field, effect] of Object.entries(actions.data)) {
        effects[field] = { ...effects[field], ...effect };
      }
    }
    return effects;
  }

  /** Rejects changes that the workflows matching the resulting ticket forbid. */
  async enforce(
    screen: WorkflowScreen,
    before: TicketSnapshot | null,
    after: TicketSnapshot,
    ctx: Omit<RuleContext, 'ticket'> = {},
  ): Promise<void> {
    const effects = await this.evaluate(screen, { ...ctx, ticket: after });
    const issues: Array<{ path: string; code: string }> = [];
    for (const [field, e] of Object.entries(effects)) {
      const now = fieldValue(after, field);
      const was = before ? fieldValue(before, field) : undefined;
      const changed = JSON.stringify(now ?? null) !== JSON.stringify(was ?? null);
      if (e.readonly && before && changed) issues.push({ path: field, code: 'readonly' });
      if (e.mandatory && e.visible !== false && empty(now))
        issues.push({ path: field, code: 'required' });
      if (e.options && changed && !empty(now)) {
        const values = Array.isArray(now) ? now : [now];
        if (values.some((v) => !e.options!.includes(String(v))))
          issues.push({ path: field, code: 'not_allowed' });
      }
    }
    if (issues.length)
      throw new AppError('validation_failed', 'The form rules reject this change.', issues);
  }
}
