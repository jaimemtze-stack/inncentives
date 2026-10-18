import { z } from 'zod';
import { LinkTypes, TicketStates } from './tickets';

const Uuid = z.string().uuid();
const Title = z.string().trim().min(1).max(250);
/** Article bodies are HTML; the API sanitises them with an allow-list. */
const Body = z.string().min(1).max(200_000);
const Tag = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(60)
  .regex(/^[^\s,<>]+( [^\s,<>]+)*$/);
const AddressList = z.array(z.string().trim().toLowerCase().email().max(254)).max(20);

/** Custom field values: scalars or lists of strings, validated per attribute. */
export const CustomFieldValuesSchema = z
  .record(
    z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    z.union([
      z.string().max(2000),
      z.number(),
      z.boolean(),
      z.array(z.string().max(200)).max(50),
      z.null(),
    ]),
  )
  .refine((r) => Object.keys(r).length <= 50);

export const TimeSpentSchema = z
  .object({
    minutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    activityTypeId: Uuid.optional(),
    billable: z.boolean().default(true),
  })
  .strict();

export const ArticleCreateSchema = z
  .object({
    type: z.enum(['email', 'phone', 'note', 'web']),
    internal: z.boolean().default(false),
    body: Body,
    subject: z.string().trim().max(500).optional(),
    to: AddressList.optional(),
    cc: AddressList.optional(),
    callDirection: z.enum(['in', 'out']).optional(),
    callNumber: z.string().trim().max(30).optional(),
    callDurationSec: z
      .number()
      .int()
      .min(0)
      .max(24 * 3600)
      .optional(),
    callOutcome: z.string().trim().max(40).optional(),
    /** Agents to notify; the UI resolves @mentions to ids. */
    mentions: z.array(Uuid).max(20).optional(),
    attachmentIds: z.array(Uuid).max(20).optional(),
    timeSpent: TimeSpentSchema.optional(),
  })
  .strict();
export type ArticleCreateInput = z.infer<typeof ArticleCreateSchema>;

const PendingUntil = z.coerce.date().nullable().optional();

export const TicketCreateSchema = z
  .object({
    title: Title,
    groupId: Uuid,
    priorityId: Uuid.optional(),
    state: z
      .enum(['new', 'open', 'pending_reminder', 'pending_close', 'resolved', 'closed'])
      .optional(),
    customerId: Uuid,
    ownerId: Uuid.nullable().optional(),
    pendingUntil: PendingUntil,
    tags: z.array(Tag).max(30).optional(),
    customFields: CustomFieldValuesSchema.optional(),
    article: ArticleCreateSchema,
    templateId: Uuid.optional(),
  })
  .strict();
export type TicketCreateInput = z.infer<typeof TicketCreateSchema>;

/** What a customer can send from the portal. */
export const PortalTicketCreateSchema = z
  .object({
    title: Title,
    body: Body,
    customFields: CustomFieldValuesSchema.optional(),
    attachmentIds: z.array(Uuid).max(20).optional(),
  })
  .strict();
export type PortalTicketCreateInput = z.infer<typeof PortalTicketCreateSchema>;

export const TicketUpdateSchema = z
  .object({
    title: Title.optional(),
    state: z.enum(TicketStates).exclude(['merged']).optional(),
    priorityId: Uuid.optional(),
    groupId: Uuid.optional(),
    ownerId: Uuid.nullable().optional(),
    customerId: Uuid.optional(),
    pendingUntil: PendingUntil,
    customFields: CustomFieldValuesSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export type TicketUpdateInput = z.infer<typeof TicketUpdateSchema>;

export const TicketListQuerySchema = z
  .object({
    overview: z
      .string()
      .regex(/^[a-z0-9-]{1,60}$/)
      .optional(),
    cursor: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const TagsSchema = z.object({ tags: z.array(Tag).min(1).max(30) }).strict();
export const MergeSchema = z.object({ targetId: Uuid }).strict();
export const SplitSchema = z.object({ articleId: Uuid, title: Title.optional() }).strict();
export const LinkSchema = z.object({ targetId: Uuid, type: z.enum(LinkTypes) }).strict();
export const ChecklistItemSchema = z
  .object({ text: z.string().trim().min(1).max(500), done: z.boolean().optional() })
  .strict();
export const ChecklistItemUpdateSchema = z
  .object({ text: z.string().trim().min(1).max(500).optional(), done: z.boolean().optional() })
  .strict();
export const SharedDraftSchema = z
  .object({
    body: z.string().max(200_000),
    meta: z.record(z.string().max(40), z.unknown()).optional(),
  })
  .strict();
export const BulkUpdateSchema = z
  .object({
    ids: z.array(Uuid).min(1).max(100),
    changes: z
      .object({
        state: z
          .enum(['open', 'pending_reminder', 'pending_close', 'resolved', 'closed'])
          .optional(),
        priorityId: Uuid.optional(),
        groupId: Uuid.optional(),
        ownerId: Uuid.nullable().optional(),
        pendingUntil: PendingUntil,
      })
      .strict()
      .optional(),
    addTags: z.array(Tag).max(30).optional(),
    macroId: Uuid.optional(),
  })
  .strict();
export type BulkUpdateInput = z.infer<typeof BulkUpdateSchema>;

// ------------------------------------------------------------ knowledge base

export const KbLocales = ['es-MX', 'en'] as const;
const KbLocale = z.enum(KbLocales);

export const KbCategorySchema = z
  .object({
    parentId: z.string().uuid().nullable().optional(),
    names: z
      .record(KbLocale, z.string().trim().min(1).max(120))
      .refine((n) => Object.keys(n).length > 0),
    slug: z.string().regex(/^[a-z0-9-]{1,80}$/),
    position: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();

export const KbTranslationSchema = z
  .object({
    title: z.string().trim().min(1).max(250),
    body: z.string().min(1).max(200_000),
    keywords: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  })
  .strict();

export const KbAnswerCreateSchema = z
  .object({
    categoryId: z.string().uuid(),
    visibility: z.enum(['customer', 'internal']).default('customer'),
    locale: KbLocale,
    translation: KbTranslationSchema,
  })
  .strict();

export const KbAnswerUpdateSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    visibility: z.enum(['customer', 'internal']).optional(),
    state: z.enum(['draft', 'published', 'archived']).optional(),
    publishAt: z.coerce.date().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
