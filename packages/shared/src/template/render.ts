/**
 * Safe template rendering for macros, text modules, signatures and notifications.
 * Only `{{ path.to.var }}` substitution from an allowlist; no expressions, no code.
 */

export const TEMPLATE_VARIABLES = [
  'ticket.number',
  'ticket.title',
  'ticket.state',
  'ticket.priority',
  'ticket.group',
  'ticket.url',
  'ticket.created_at',
  'ticket.owner.firstname',
  'ticket.owner.lastname',
  'customer.firstname',
  'customer.lastname',
  'customer.email',
  'organization.name',
  'agent.firstname',
  'agent.lastname',
  'agent.email',
  'group.name',
  'config.product_name',
  'config.support_email',
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateContext = Partial<
  Record<TemplateVariable, string | number | Date | null | undefined>
>;

const VAR_RE = /\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}/g;
const ALLOWED = new Set<string>(TEMPLATE_VARIABLES);

export interface RenderOptions {
  /** Escape values for HTML output (default true). */
  escapeHtml?: boolean;
  /** Placeholder for allowed-but-missing values (Zammad shows "-"). */
  missing?: string;
  /** Formatter for Date values. */
  formatDate?: (d: Date) => string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderTemplate(
  template: string,
  ctx: TemplateContext,
  opts: RenderOptions = {},
): string {
  const esc = opts.escapeHtml ?? true;
  const missing = opts.missing ?? '-';
  const fmt = opts.formatDate ?? ((d: Date) => d.toISOString());
  return template.replace(VAR_RE, (whole, name: string) => {
    if (!ALLOWED.has(name)) return esc ? escapeHtml(whole) : whole;
    const v = ctx[name as TemplateVariable];
    if (v === null || v === undefined || v === '') return missing;
    const s = v instanceof Date ? fmt(v) : String(v);
    return esc ? escapeHtml(s) : s;
  });
}

/** Returns variables used in the template that are not in the allowlist. */
export function findUnknownVariables(template: string): string[] {
  const unknown = new Set<string>();
  for (const m of template.matchAll(VAR_RE)) if (!ALLOWED.has(m[1]!)) unknown.add(m[1]!);
  return [...unknown];
}
