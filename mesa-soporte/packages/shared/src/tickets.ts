export const TicketStates = [
  'new',
  'open',
  'pending_reminder',
  'pending_close',
  'resolved',
  'closed',
  'merged',
] as const;
export type TicketState = (typeof TicketStates)[number];

/** States in which the ticket is considered open for SLA and views. */
export const OpenStates: readonly TicketState[] = [
  'new',
  'open',
  'pending_reminder',
  'pending_close',
];
export const PendingStates: readonly TicketState[] = ['pending_reminder', 'pending_close'];

export const TicketChannels = ['email', 'phone', 'web', 'agent'] as const;
export type TicketChannel = (typeof TicketChannels)[number];

export const ArticleTypes = ['email', 'phone', 'note', 'web', 'system'] as const;
export type ArticleType = (typeof ArticleTypes)[number];

export const ArticleSenders = ['customer', 'agent', 'system'] as const;
export type ArticleSender = (typeof ArticleSenders)[number];

/** Group access levels (Zammad semantics). */
export const GroupAccessLevels = ['read', 'create', 'change', 'overview', 'full'] as const;
export type GroupAccessLevel = (typeof GroupAccessLevels)[number];

export const LinkTypes = ['parent', 'child', 'related'] as const;
export type LinkType = (typeof LinkTypes)[number];

export const ObjectAttributeTypes = [
  'text',
  'textarea',
  'select',
  'multiselect',
  'boolean',
  'integer',
  'date',
] as const;
export type ObjectAttributeType = (typeof ObjectAttributeTypes)[number];

export const WorkflowScreens = [
  'create_agent',
  'create_customer',
  'edit_agent',
  'edit_customer',
] as const;
export type WorkflowScreen = (typeof WorkflowScreens)[number];
