import { zipEntries, zipRead } from './zip';

export type SensitiveKind = 'rfc' | 'curp' | 'nss' | 'clabe' | 'card' | 'salary_column';

export interface SensitiveFinding {
  kind: SensitiveKind;
  count: number;
}

const CURP_CHARS = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';

function validDate(yy: string, mm: string, dd: string): boolean {
  const m = Number(mm);
  const d = Number(dd);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && /^\d\d$/.test(yy);
}

export function curpValid(curp: string): boolean {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += CURP_CHARS.indexOf(curp[i]!) * (18 - i);
  const check = (10 - (sum % 10)) % 10;
  return (
    check === Number(curp[17]) && validDate(curp.slice(4, 6), curp.slice(6, 8), curp.slice(8, 10))
  );
}

export function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function clabeValid(clabe: string): boolean {
  const w = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += ((clabe.charCodeAt(i) - 48) * w[i % 3]!) % 10;
  return (10 - (sum % 10)) % 10 === clabe.charCodeAt(17) - 48;
}

interface Pattern {
  kind: SensitiveKind;
  re: RegExp;
  valid: (m: string) => boolean;
}

// Word boundaries are explicit so digits inside longer numbers do not match.
const PATTERNS: Pattern[] = [
  {
    kind: 'curp',
    re: /(?<![A-Z0-9])[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d(?![A-Z0-9])/g,
    valid: curpValid,
  },
  {
    // RFC of a natural person (13 characters); company RFCs are not personal data.
    kind: 'rfc',
    re: /(?<![A-Z0-9Ñ&])[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}(?![A-Z0-9])/g,
    valid: (m) => validDate(m.slice(4, 6), m.slice(6, 8), m.slice(8, 10)),
  },
  { kind: 'clabe', re: /(?<!\d)\d{18}(?!\d)/g, valid: clabeValid },
  { kind: 'nss', re: /(?<!\d)\d{11}(?!\d)/g, valid: luhn },
  {
    kind: 'card',
    re: /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g,
    valid: (m) => {
      const d = m.replace(/[ -]/g, '');
      return d.length >= 13 && d.length <= 19 && /^[3-6]/.test(d) && luhn(d);
    },
  },
];

const SALARY_HEADER =
  /\b(sueldos?|salarios?|salary|salaries|percepci[oó]n(es)?|neto a pagar|sueldo (base|bruto|neto)|sdi|sbc)\b/i;

const MAX_TEXT = 2_000_000;

/** Finds likely personal or payroll data in free text. */
export function detectText(text: string): SensitiveFinding[] {
  const t = text.slice(0, MAX_TEXT).toUpperCase();
  const counts = new Map<SensitiveKind, number>();
  const seen = new Set<string>();
  for (const p of PATTERNS) {
    for (const m of t.matchAll(p.re)) {
      const v = m[0];
      if (seen.has(v) || !p.valid(v)) continue;
      seen.add(v);
      counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    }
  }
  return [...counts].map(([kind, count]) => ({ kind, count }));
}

/** Replaces every detected value with a marker. Used by agent redaction. */
export function redactText(text: string, marker = '[REDACTADO]'): string {
  let out = text;
  for (const p of PATTERNS) {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- built from constant patterns
    const re = new RegExp(p.re.source, 'gi');
    out = out.replace(re, (m) => (p.valid(m.toUpperCase()) ? marker : m));
  }
  return out;
}

function headerFindings(firstLine: string): SensitiveFinding[] {
  return SALARY_HEADER.test(firstLine) ? [{ kind: 'salary_column', count: 1 }] : [];
}

function merge(...lists: SensitiveFinding[][]): SensitiveFinding[] {
  const m = new Map<SensitiveKind, number>();
  for (const l of lists) for (const f of l) m.set(f.kind, (m.get(f.kind) ?? 0) + f.count);
  return [...m].map(([kind, count]) => ({ kind, count }));
}

function xmlText(xml: string): string {
  return xml
    .replace(/<\/(w:p|row|si|text:p)>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const OFFICE_PARTS =
  /^(xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml|word\/document\.xml|content\.xml)$/;
const MAX_INFLATE = 20 * 1024 * 1024;

/** Scans a file's content according to its (sniffed) type. */
export function detectFile(buf: Buffer, kind: 'text' | 'office' | 'other'): SensitiveFinding[] {
  if (kind === 'text') {
    const text = buf.subarray(0, MAX_TEXT).toString('utf8');
    const first = text.split(/\r?\n/, 1)[0] ?? '';
    return merge(detectText(text), headerFindings(first));
  }
  if (kind === 'office') {
    let budget = MAX_INFLATE;
    const parts: string[] = [];
    for (const e of zipEntries(buf)) {
      if (!OFFICE_PARTS.test(e.name) || budget <= 0) continue;
      const data = zipRead(buf, e, budget);
      budget -= data.length;
      parts.push(xmlText(data.toString('utf8')));
    }
    const text = parts.join('\n');
    // Spreadsheet headers usually sit in the shared strings: check them all.
    const salary = SALARY_HEADER.test(text.slice(0, 200_000))
      ? [{ kind: 'salary_column' as const, count: 1 }]
      : [];
    return merge(detectText(text), salary);
  }
  return [];
}
