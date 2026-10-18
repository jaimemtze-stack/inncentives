import {
  ActionsSchema,
  ConditionSchema,
  GroupAccessLevels,
  ObjectAttributeTypes,
  Permission,
  Roles,
  WorkflowActionsSchema,
  WorkflowScreens,
  validateCondition,
  type ConditionNode,
  type RuleAction,
} from '@mesa/shared';
import { z } from 'zod';
import { GraphConfigSchema, ImapConfigSchema } from '../channels/email/adapters';
import { TeamsEvents, isTeamsWebhookUrl } from '../integrations/teams';
import { validateCalendar, type CalendarDefinition } from '../sla/calendar';

/**
 * Admin-editable configuration. Each resource declares its Prisma model, the
 * Zod schema of what admins may write, and extra validation (rules are
 * validated against the field catalogue before they are stored).
 */
export interface ResourceDef {
  model: string;
  create: z.ZodTypeAny;
  /** Defaults to create.partial() for object schemas. */
  update?: z.ZodTypeAny;
  /** Checks the merged record; returns warnings (errors throw). */
  validate?: (data: Record<string, unknown>) => string[];
  /** Hides write-only fields in responses. */
  serialize?: (row: Record<string, unknown>) => Record<string, unknown>;
  /** Extra Prisma include for list/read. */
  include?: Record<string, unknown>;
  orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>;
  /** Rows that may never be deleted (system records). */
  protectedIds?: string[];
  /** Fixed set of rows: only listing and updating. */
  fixed?: boolean;
}

const Uuid = z.string().uuid();
const Name = z.string().trim().min(1).max(120);
const Cond = ConditionSchema;

export class RuleValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join('; '));
  }
}

function checkCondition(node: unknown, usage: { event: boolean; queryable: boolean }): void {
  const errors = validateCondition(node as ConditionNode, usage);
  if (errors.length) throw new RuleValidationError(errors);
}

const FIELD_OF_ACTION: Record<string, string> = {
  state: 'ticket.state',
  priority_id: 'ticket.priority_id',
  group_id: 'ticket.group_id',
  owner_id: 'ticket.owner_id',
};

function fieldsIn(node: ConditionNode, out = new Set<string>()): Set<string> {
  if ('conditions' in node) node.conditions.forEach((c) => fieldsIn(c, out));
  else out.add(node.field);
  return out;
}

/** Warns when a trigger changes a field its own conditions look at (loop risk). */
export function loopWarnings(conditions: ConditionNode, actions: RuleAction[]): string[] {
  const watched = fieldsIn(conditions);
  const warnings: string[] = [];
  for (const a of actions) {
    if (a.type === 'set' && FIELD_OF_ACTION[a.field] && watched.has(FIELD_OF_ACTION[a.field]!)) {
      warnings.push(`loop_risk:${a.field}`);
    }
    if ((a.type === 'add_tags' || a.type === 'remove_tags') && watched.has('ticket.tags'))
      warnings.push('loop_risk:tags');
    if (a.type === 'set_custom' && watched.has(`ticket.custom.${a.key}`))
      warnings.push(`loop_risk:custom.${a.key}`);
  }
  return warnings;
}

const Hours = z.record(
  z.enum(['0', '1', '2', '3', '4', '5', '6']),
  z.array(z.tuple([z.string(), z.string()])).max(4),
);

const MinutesOrNull = z
  .number()
  .int()
  .min(1)
  .max(365 * 24 * 60)
  .nullable();

export const RESOURCES: Record<string, ResourceDef> = {
  groups: {
    model: 'group',
    create: z
      .object({
        name: Name,
        emailAddress: z.string().email().max(254).nullable().optional(),
        signatureId: Uuid.nullable().optional(),
        followUp: z.enum(['reopen', 'new_ticket']).default('reopen'),
        autoAssign: z.boolean().default(false),
        active: z.boolean().default(true),
      })
      .strict(),
    orderBy: { name: 'asc' },
    protectedIds: ['00000000-0000-4000-8000-000000000304'],
  },
  priorities: {
    model: 'ticketPriority',
    create: z
      .object({
        name: z.string().trim().min(1).max(60),
        rank: z.number().int().min(1).max(20),
        isDefault: z.boolean().default(false),
        active: z.boolean().default(true),
      })
      .strict(),
    orderBy: { rank: 'asc' },
  },
  'custom-roles': {
    model: 'customRole',
    create: z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().max(300).nullable().optional(),
        // Custom roles only extend staff; the customer permission is never grantable.
        permissions: z
          .array(z.enum(Object.values(Permission) as [string, ...string[]]))
          .max(30)
          .refine((p) => !p.includes(Permission.TicketsCustomer)),
        active: z.boolean().default(true),
      })
      .strict(),
    orderBy: { name: 'asc' },
  },
  'support-plans': {
    model: 'supportPlan',
    create: z
      .object({
        name: Name,
        includedMinutesPerMonth: z.number().int().min(0).max(1_000_000).nullable().optional(),
        hourlyRateCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
        active: z.boolean().default(true),
      })
      .strict(),
    orderBy: { name: 'asc' },
  },
  signatures: {
    model: 'signature',
    create: z
      .object({ name: Name, body: z.string().min(1).max(5000), active: z.boolean().default(true) })
      .strict(),
    orderBy: { name: 'asc' },
  },
  calendars: {
    model: 'businessCalendar',
    create: z
      .object({
        name: Name,
        timezone: z.string().min(1).max(64),
        hours: Hours,
        holidays: z
          .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
          .max(200)
          .default([]),
        mexicoStatutory: z.boolean().default(true),
        isDefault: z.boolean().default(false),
      })
      .strict(),
    validate: (d) => {
      try {
        validateCalendar(d as unknown as CalendarDefinition);
      } catch (err) {
        throw new RuleValidationError([(err as Error).message]);
      }
      return [];
    },
    orderBy: { name: 'asc' },
  },
  slas: {
    model: 'sla',
    create: z
      .object({
        name: Name,
        conditions: Cond,
        calendarId: Uuid,
        pauseOnPending: z.boolean().default(true),
        warnPercent: z.number().int().min(10).max(99).default(80),
        position: z.number().int().min(0).max(10_000).default(0),
        active: z.boolean().default(true),
        targets: z
          .array(
            z
              .object({
                priorityId: Uuid,
                firstResponseMinutes: MinutesOrNull,
                updateMinutes: MinutesOrNull,
                solutionMinutes: MinutesOrNull,
              })
              .strict(),
          )
          .max(20),
      })
      .strict(),
    validate: (d) => {
      checkCondition(d.conditions, { event: false, queryable: false });
      return [];
    },
    include: { targets: true },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  },
  triggers: {
    model: 'trigger',
    create: z
      .object({
        name: Name,
        event: z.enum(['create', 'update', 'create_or_update']),
        conditions: Cond,
        actions: ActionsSchema.refine((a) => a.length > 0),
        position: z.number().int().min(0).max(10_000).default(0),
        active: z.boolean().default(true),
      })
      .strict(),
    validate: (d) => {
      checkCondition(d.conditions, { event: true, queryable: false });
      return loopWarnings(d.conditions as ConditionNode, d.actions as RuleAction[]);
    },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  },
  schedulers: {
    model: 'scheduler',
    create: z
      .object({
        name: Name,
        conditions: Cond,
        actions: ActionsSchema.refine((a) => a.length > 0),
        intervalMinutes: z
          .number()
          .int()
          .min(10)
          .max(7 * 24 * 60)
          .default(60),
        limitPerRun: z.number().int().min(1).max(2000).default(500),
        calendarId: Uuid.nullable().optional(),
        active: z.boolean().default(true),
      })
      .strict(),
    validate: (d) => {
      checkCondition(d.conditions, { event: false, queryable: true });
      const c = d.conditions as ConditionNode;
      if ('conditions' in c && c.conditions.length === 0)
        throw new RuleValidationError(['scheduler needs at least one condition']);
      return [];
    },
    orderBy: { name: 'asc' },
  },
  'core-workflows': {
    model: 'coreWorkflow',
    create: z
      .object({
        name: Name,
        screens: z.array(z.enum(WorkflowScreens)).min(1).max(4),
        conditions: Cond,
        actions: WorkflowActionsSchema,
        position: z.number().int().min(0).max(10_000).default(0),
        active: z.boolean().default(true),
      })
      .strict(),
    validate: (d) => {
      checkCondition(d.conditions, { event: false, queryable: false });
      return [];
    },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  },
  macros: {
    model: 'macro',
    create: z
      .object({
        name: Name,
        actions: ActionsSchema.refine((a) => a.length > 0),
        groupIds: z.array(Uuid).max(50).default([]),
        active: z.boolean().default(true),
      })
      .strict(),
    orderBy: { name: 'asc' },
  },
  'text-modules': {
    model: 'textModule',
    create: z
      .object({
        keyword: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .regex(/^[\w-]+$/),
        name: Name,
        content: z.string().min(1).max(20_000),
        locale: z.enum(['es-MX', 'en']).default('es-MX'),
        groupIds: z.array(Uuid).max(50).default([]),
        active: z.boolean().default(true),
      })
      .strict(),
    orderBy: { keyword: 'asc' },
  },
  'ticket-templates': {
    model: 'ticketTemplate',
    create: z
      .object({
        name: Name,
        fields: z
          .object({
            title: z.string().max(250).optional(),
            groupId: Uuid.optional(),
            priorityId: Uuid.optional(),
            state: z.string().max(20).optional(),
            body: z.string().max(20_000).optional(),
            tags: z.array(z.string().max(60)).max(20).optional(),
            customFields: z.record(z.string().max(40), z.unknown()).optional(),
          })
          .strict(),
        active: z.boolean().default(true),
      })
      .strict(),
    orderBy: { name: 'asc' },
  },
  overviews: {
    model: 'overview',
    create: z
      .object({
        name: Name,
        slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
        conditions: Cond,
        columns: z
          .array(z.string().regex(/^[a-z_]{1,40}$/))
          .min(1)
          .max(15),
        orderBy: z
          .string()
          .regex(/^[a-z_]{1,40}$/)
          .default('updated_at'),
        orderDir: z.enum(['asc', 'desc']).default('desc'),
        roles: z.array(z.enum(Roles)).min(1),
        position: z.number().int().min(0).max(10_000).default(0),
        active: z.boolean().default(true),
      })
      .strict(),
    validate: (d) => {
      checkCondition(d.conditions, { event: false, queryable: true });
      return [];
    },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  },
  'object-attributes': {
    model: 'objectAttribute',
    create: z
      .object({
        object: z.enum(['ticket', 'user', 'organization']),
        name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
        label: Name,
        labelEn: z.string().max(120).nullable().optional(),
        dataType: z.enum(ObjectAttributeTypes),
        options: z
          .array(
            z
              .object({
                value: z.string().min(1).max(100),
                label: z.string().min(1).max(120),
                labelEn: z.string().max(120).optional(),
              })
              .strict(),
          )
          .max(200)
          .default([]),
        required: z.boolean().default(false),
        visibleToCustomer: z.boolean().default(false),
        editableByCustomer: z.boolean().default(false),
        position: z.number().int().min(0).max(10_000).default(0),
        active: z.boolean().default(true),
      })
      .strict(),
    validate: (d) => {
      if (d.editableByCustomer && !d.visibleToCustomer)
        throw new RuleValidationError(['editable fields must be visible to customers']);
      if (
        ['select', 'multiselect'].includes(String(d.dataType)) &&
        !(d.options as unknown[]).length
      ) {
        throw new RuleValidationError(['select fields need options']);
      }
      return [];
    },
    orderBy: [{ object: 'asc' }, { position: 'asc' }],
  },
  'activity-types': {
    model: 'activityType',
    create: z
      .object({ name: z.string().trim().min(1).max(80), active: z.boolean().default(true) })
      .strict(),
    orderBy: { name: 'asc' },
  },
  'email-channels': {
    model: 'emailChannel',
    create: z
      .object({
        name: Name,
        address: z.string().trim().toLowerCase().email().max(254),
        adapter: z.enum(['graph', 'imap']),
        groupId: Uuid,
        config: z.record(z.string(), z.unknown()),
        // Name of the secret file (OCI Vault → /run/secrets); never the secret itself.
        secretName: z
          .string()
          .regex(/^[a-z0-9_]{1,60}$/)
          .nullable()
          .optional(),
        trustedAuthServ: z
          .string()
          .trim()
          .toLowerCase()
          .max(200)
          .regex(/^[a-z0-9.-]+$/)
          .nullable()
          .optional(),
        active: z.boolean().default(true),
      })
      .strict(),
    validate: (d) => {
      const r = (d.adapter === 'graph' ? GraphConfigSchema : ImapConfigSchema).safeParse(d.config);
      if (!r.success)
        throw new RuleValidationError(
          r.error.issues.map((i) => `config.${i.path.join('.')}: ${i.message}`),
        );
      return d.trustedAuthServ ? [] : ['no_trusted_auth_serv: every sender goes to triage'];
    },
    orderBy: { name: 'asc' },
  },
  'postmaster-filters': {
    model: 'postmasterFilter',
    create: z
      .object({
        name: Name,
        match: z
          .array(
            z
              .object({
                header: z.string().regex(/^[A-Za-z0-9-]{1,60}$/),
                operator: z.enum(['contains', 'is', 'starts_with', 'ends_with']),
                value: z.string().min(1).max(200),
              })
              .strict(),
          )
          .min(1)
          .max(10),
        set: z
          .object({
            groupId: Uuid.optional(),
            priorityId: Uuid.optional(),
            tags: z.array(z.string().max(60)).max(10).optional(),
            ignore: z.boolean().optional(),
            spam: z.boolean().optional(),
          })
          .strict(),
        position: z.number().int().min(0).max(10_000).default(0),
        active: z.boolean().default(true),
      })
      .strict(),
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  },
  webhooks: {
    model: 'webhook',
    create: z
      .object({
        name: Name,
        url: z
          .string()
          .url()
          .max(500)
          .refine((u) => u.startsWith('https://'), 'HTTPS only'),
        /** Write-only; stored encrypted. */
        secret: z.string().min(16).max(200).optional(),
        active: z.boolean().default(true),
      })
      .strict(),
    serialize: ({ secretEnc, ...rest }) => ({ ...rest, hasSecret: !!secretEnc }),
    orderBy: { name: 'asc' },
  },
  'teams-channels': {
    model: 'teamsChannel',
    create: z
      .object({
        groupId: Uuid,
        name: Name,
        /** Write-only; the URL embeds a credential and is stored encrypted. */
        url: z
          .string()
          .max(2000)
          .refine(isTeamsWebhookUrl, 'Teams or Workflows HTTPS URL only')
          .optional(),
        events: z.array(z.enum(TeamsEvents)).min(1),
        active: z.boolean().default(true),
      })
      .strict(),
    validate: (d) => {
      if (!d.url && !d.urlEnc) throw new RuleValidationError(['url is required']);
      return [];
    },
    serialize: ({ urlEnc, ...rest }) => ({ ...rest, hasUrl: !!urlEnc }),
    orderBy: { name: 'asc' },
  },
  'retention-policies': {
    model: 'retentionPolicy',
    create: z.object({ days: z.number().int().min(1).max(36_500), active: z.boolean() }).strict(),
    orderBy: { target: 'asc' },
    fixed: true,
  },
};

export const GroupAccessSchema = z
  .array(
    z.object({ groupId: Uuid, levels: z.array(z.enum(GroupAccessLevels)).min(1).max(5) }).strict(),
  )
  .max(100);
