import { TemplateVariables } from '@mesa/shared';
import { escapeHtml } from './sanitize';

export type TemplateValues = Partial<Record<(typeof TemplateVariables)[number], string | null>>;

const ALLOWED = new Set<string>(TemplateVariables);

/**
 * Renders {{variable}} placeholders from a fixed allow-list. There is no
 * expression language: unknown names render empty, and values are
 * HTML-escaped when the output is HTML, so admins cannot inject markup through
 * customer-controlled values such as names or titles.
 */
export function renderTemplate(template: string, values: TemplateValues, html: boolean): string {
  return template.replace(/\{\{\s*([\w.]{1,60})\s*\}\}/g, (_m, name: string) => {
    if (!ALLOWED.has(name)) return '';
    const v = values[name as keyof TemplateValues] ?? '';
    return html ? escapeHtml(v) : v;
  });
}
