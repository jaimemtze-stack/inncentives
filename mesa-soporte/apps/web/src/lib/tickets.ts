import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export interface Ref {
  id: string;
  name: string;
}

export interface TicketRow {
  id: string;
  number: string;
  title: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  escalationAt?: string | null;
  slaWarningAt?: string | null;
  pendingUntil?: string | null;
  sensitiveData?: boolean;
  unverifiedFrom?: string | null;
  priority: { id?: string; name: string; rank: number };
  group?: Ref;
  owner?: Ref | null;
  customer?: Ref | null;
  organization?: Ref | null;
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  contentType: string;
  scanStatus: string;
}

export interface Article {
  id: string;
  type: string;
  sender: string;
  subject: string | null;
  bodyHtml: string;
  createdAt: string;
  authorName: string | null;
  attachments: Attachment[];
  redacted: boolean;
  internal?: boolean;
  from?: string | null;
  to?: string | null;
  deliveryStatus?: string | null;
  deliveryError?: string | null;
  callDirection?: string | null;
  callNumber?: string | null;
  callDurationSec?: number | null;
  sensitiveData?: boolean;
}

export interface Attribute {
  name: string;
  label: string;
  labelEn: string | null;
  dataType: string;
  options: Array<{ value: string; label: string; labelEn?: string }>;
  required: boolean;
  editableByCustomer: boolean;
}

export interface FormMeta {
  attributes: Attribute[];
  groups?: Array<Ref & { isTriage: boolean }>;
  priorities?: Array<Ref & { rank: number; isDefault: boolean }>;
  states?: string[];
  activityTypes?: Ref[];
  textModules?: Array<{ id: string; keyword: string; name: string; content: string }>;
  templates?: Array<{ id: string; name: string; fields: Record<string, unknown> }>;
  macros?: Array<Ref & { groupIds: string[] }>;
  ownersByGroup?: Record<string, Ref[]>;
  timeAccounting?: { enabled: boolean; required: boolean };
  privacyNotice?: { es: string; en: string };
  customerCanClose?: boolean;
}

export function useFormMeta() {
  return useQuery({
    queryKey: ['form-meta'],
    queryFn: () => api<FormMeta>('GET', '/ticket-form'),
    staleTime: 300_000,
  });
}

/** Plain text (textarea) to the HTML the API expects; the server sanitises it again. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    text
      .replace(/\r\n?/g, '\n')
      .split(/\n{2,}/)
      // nosemgrep: javascript.lang.security.html-in-template-string.html-in-template-string -- value escaped
      .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
      .join('')
  );
}

export function formatDate(iso: string | null | undefined, lng: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(lng.startsWith('en') ? 'en-US' : 'es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(new Date(iso));
}

export function slaState(t: {
  escalationAt?: string | null;
  slaWarningAt?: string | null;
}): 'breached' | 'warning' | null {
  const now = Date.now();
  if (t.escalationAt && new Date(t.escalationAt).getTime() <= now) return 'breached';
  if (t.slaWarningAt && new Date(t.slaWarningAt).getTime() <= now) return 'warning';
  return null;
}
