export const TICKET_STATES = [
  'new',
  'open',
  'pending_reminder',
  'pending_close',
  'resolved',
  'closed',
  'merged',
] as const;
export type TicketStateName = (typeof TICKET_STATES)[number];

export const PENDING_STATES: readonly TicketStateName[] = ['pending_reminder', 'pending_close'];
export const CLOSED_STATES: readonly TicketStateName[] = ['resolved', 'closed', 'merged'];

export const TICKET_PRIORITIES = [
  { value: 1, key: 'low' },
  { value: 2, key: 'normal' },
  { value: 3, key: 'high' },
  { value: 4, key: 'critical' },
] as const;

export const ARTICLE_TYPES = ['email', 'phone', 'note', 'web', 'system'] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

export const ARTICLE_SENDERS = ['customer', 'agent', 'system'] as const;
export const ARTICLE_VISIBILITY = ['public', 'internal'] as const;

export const ATTACHMENT_SCAN_STATES = ['pending', 'clean', 'infected', 'error'] as const;
