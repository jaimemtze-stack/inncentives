import { z } from 'zod';
import { ArticleSenders, ArticleTypes, TicketChannels, TicketStates } from './tickets';

/**
 * Field catalogue shared by triggers, schedulers, SLAs, overviews and core
 * workflows. Only these fields and operators exist: rules are data, never
 * code, and are validated before they are stored.
 */
export type FieldType = 'string' | 'text' | 'enum' | 'id' | 'tags' | 'date' | 'boolean' | 'number';

export interface FieldDef {
  type: FieldType;
  /** Can be translated to a database query (overviews, schedulers). */
  queryable: boolean;
  /** Enum values when type === 'enum'. */
  values?: readonly string[];
  /** Supports the event operators "changed" / "changed_to" (triggers). */
  trackable?: boolean;
  label: { es: string; en: string };
}

export const ConditionFields = {
  'ticket.number': { type: 'string', queryable: true, label: { es: 'Número', en: 'Number' } },
  'ticket.title': { type: 'text', queryable: true, label: { es: 'Título', en: 'Title' } },
  'ticket.state': { type: 'enum', values: TicketStates, queryable: true, trackable: true, label: { es: 'Estado', en: 'State' } },
  'ticket.priority_id': { type: 'id', queryable: true, trackable: true, label: { es: 'Prioridad', en: 'Priority' } },
  'ticket.group_id': { type: 'id', queryable: true, trackable: true, label: { es: 'Grupo', en: 'Group' } },
  'ticket.owner_id': { type: 'id', queryable: true, trackable: true, label: { es: 'Propietario', en: 'Owner' } },
  'ticket.customer_id': { type: 'id', queryable: true, label: { es: 'Cliente', en: 'Customer' } },
  'ticket.organization_id': { type: 'id', queryable: true, label: { es: 'Organización', en: 'Organization' } },
  'ticket.tags': { type: 'tags', queryable: true, label: { es: 'Etiquetas', en: 'Tags' } },
  'ticket.channel': { type: 'enum', values: TicketChannels, queryable: true, label: { es: 'Canal', en: 'Channel' } },
  'ticket.pending_until': { type: 'date', queryable: true, label: { es: 'Pendiente hasta', en: 'Pending until' } },
  'ticket.escalation_at': { type: 'date', queryable: true, label: { es: 'Escalamiento', en: 'Escalation' } },
  'ticket.created_at': { type: 'date', queryable: true, label: { es: 'Creado', en: 'Created' } },
  'ticket.updated_at': { type: 'date', queryable: true, label: { es: 'Actualizado', en: 'Updated' } },
  'ticket.last_customer_contact_at': { type: 'date', queryable: true, label: { es: 'Último contacto del cliente', en: 'Last customer contact' } },
  'ticket.sensitive_data': { type: 'boolean', queryable: true, label: { es: 'Contiene datos sensibles', en: 'Contains sensitive data' } },
  'article.type': { type: 'enum', values: ArticleTypes, queryable: false, label: { es: 'Tipo de artículo', en: 'Article type' } },
  'article.sender': { type: 'enum', values: ArticleSenders, queryable: false, label: { es: 'Remitente (tipo)', en: 'Sender type' } },
  'article.internal': { type: 'boolean', queryable: false, label: { es: 'Nota interna', en: 'Internal' } },
  'article.from': { type: 'string', queryable: false, label: { es: 'De', en: 'From' } },
  'article.subject': { type: 'text', queryable: false, label: { es: 'Asunto', en: 'Subject' } },
  'article.body': { type: 'text', queryable: false, label: { es: 'Cuerpo', en: 'Body' } },
  'customer.email': { type: 'string', queryable: false, label: { es: 'Correo del cliente', en: 'Customer email' } },
  'organization.support_plan_id': { type: 'id', queryable: true, label: { es: 'Plan de soporte', en: 'Support plan' } },
} as const satisfies Record<string, FieldDef>;

export type ConditionFieldKey = keyof typeof ConditionFields;

export const OperatorsByType: Record<FieldType, readonly string[]> = {
  string: ['is', 'is_not', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_set', 'not_set'],
  text: ['contains', 'not_contains', 'is_set', 'not_set'],
  enum: ['is', 'is_not', 'in', 'not_in'],
  id: ['is', 'is_not', 'in', 'not_in', 'is_set', 'not_set'],
  tags: ['contains_all', 'contains_one', 'contains_none'],
  date: ['before', 'after', 'before_relative', 'after_relative', 'is_set', 'not_set'],
  boolean: ['is'],
  number: ['is', 'gt', 'lt'],
};
export const EventOperators = ['changed', 'changed_to'] as const;

/** Custom ticket fields are addressed as ticket.custom.<key>. */
export const CUSTOM_FIELD_PREFIX = 'ticket.custom.';
const customFieldRe = /^ticket\.custom\.[a-z][a-z0-9_]{0,39}$/;

/** Placeholder resolved at evaluation time (overviews: "my tickets"). */
export const CURRENT_USER = 'current_user';

export interface LeafCondition {
  field: string;
  operator: string;
  value?: unknown;
}
export interface GroupCondition {
  op: 'and' | 'or';
  conditions: ConditionNode[];
}
export type ConditionNode = LeafCondition | GroupCondition;

export function isGroup(n: ConditionNode): n is GroupCondition {
  return 'op' in n;
}

const scalar = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
const valueSchema = z.union([scalar, z.array(z.union([z.string().max(200), z.number()])).max(100), z.object({ minutes: z.number().int().min(-525_600).max(525_600) }).strict()]);

const leafSchema = z
  .object({ field: z.string().max(80), operator: z.string().max(30), value: valueSchema.optional() })
  .strict();

export const ConditionSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(['and', 'or']), conditions: z.array(ConditionSchema).max(30) }).strict(),
    leafSchema,
  ]),
);

export interface ConditionUsage {
  /** Rules that run on events may use article.* fields and event operators. */
  event: boolean;
  /** Rules translated to SQL may only use queryable fields. */
  queryable: boolean;
}

/** Semantic validation on top of the schema: known fields, valid operators, sane values, bounded size. */
export function validateCondition(node: ConditionNode, usage: ConditionUsage, depth = 0, counter = { n: 0 }): string[] {
  const errors: string[] = [];
  if (++counter.n > 60) return ['condition too large'];
  if (depth > 4) return ['condition nested too deeply'];
  if (isGroup(node)) {
    for (const c of node.conditions) errors.push(...validateCondition(c, usage, depth + 1, counter));
    return errors;
  }
  const isCustom = customFieldRe.test(node.field);
  const def: FieldDef | undefined = isCustom
    ? { type: 'string', queryable: true, label: { es: '', en: '' } }
    : (ConditionFields as Record<string, FieldDef>)[node.field];
  if (!def) return [`unknown field ${node.field}`];
  if (usage.queryable && !def.queryable) errors.push(`${node.field} cannot be used here`);
  const eventOp = (EventOperators as readonly string[]).includes(node.operator);
  if (eventOp) {
    if (!usage.event) errors.push(`${node.operator} only works in triggers`);
    if (!def.trackable) errors.push(`${node.field} does not support ${node.operator}`);
  } else if (!OperatorsByType[def.type].includes(node.operator)) {
    errors.push(`operator ${node.operator} not valid for ${node.field}`);
  }
  const needsValue = !['is_set', 'not_set', 'changed'].includes(node.operator);
  if (needsValue && node.value === undefined) errors.push(`${node.field}: value required`);
  if (['in', 'not_in', 'contains_all', 'contains_one', 'contains_none'].includes(node.operator) && !Array.isArray(node.value)) {
    errors.push(`${node.field}: list expected`);
  }
  if (['before_relative', 'after_relative'].includes(node.operator) && typeof (node.value as { minutes?: unknown })?.minutes !== 'number') {
    errors.push(`${node.field}: {minutes} expected`);
  }
  if (def.type === 'enum' && def.values && needsValue) {
    const vals = Array.isArray(node.value) ? node.value : [node.value];
    for (const v of vals) if (!def.values.includes(String(v))) errors.push(`${node.field}: invalid value ${String(v)}`);
  }
  return errors;
}

// ------------------------------------------------------------------ actions

/** Variables usable in notification/e-mail templates: {{ticket.number}}. */
export const TemplateVariables = [
  'ticket.number',
  'ticket.title',
  'ticket.state',
  'ticket.priority',
  'ticket.group',
  'ticket.url',
  'customer.name',
  'customer.firstname',
  'customer.email',
  'organization.name',
  'owner.name',
  'agent.name',
  'config.app_name',
] as const;

export const SettableTicketFields = ['state', 'priority_id', 'group_id', 'owner_id', 'pending_until_minutes'] as const;

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set'), field: z.enum(SettableTicketFields), value: z.union([z.string().max(100), z.number().int(), z.null()]) }).strict(),
  z.object({ type: z.literal('set_custom'), key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]) }).strict(),
  z.object({ type: z.literal('add_tags'), tags: z.array(z.string().min(1).max(60)).min(1).max(20) }).strict(),
  z.object({ type: z.literal('remove_tags'), tags: z.array(z.string().min(1).max(60)).min(1).max(20) }).strict(),
  z.object({
    type: z.literal('notify'),
    recipients: z.array(z.union([z.enum(['owner', 'group', 'subscribers', 'customer']), z.string().regex(/^user:[0-9a-f-]{36}$/)])).min(1).max(10),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
  }).strict(),
  z.object({ type: z.literal('add_note'), body: z.string().min(1).max(5000) }).strict(),
  z.object({ type: z.literal('reply_customer'), subject: z.string().min(1).max(200), body: z.string().min(1).max(10_000) }).strict(),
]);
export type RuleAction = z.infer<typeof ActionSchema>;
export const ActionsSchema = z.array(ActionSchema).max(20);
