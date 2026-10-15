import { clabeValid, curpValid, luhnValid, nssValid, rfcValid } from './validators';

export type SensitiveType = 'rfc' | 'curp' | 'nss' | 'clabe' | 'card' | 'salary_column';

export interface SensitiveFinding {
  type: SensitiveType;
  count: number;
  /** Masked samples for display (never the full value). */
  samples: string[];
}

export interface SensitiveReport {
  hasSensitiveData: boolean;
  findings: SensitiveFinding[];
}

interface Pattern {
  type: Exclude<SensitiveType, 'salary_column'>;
  regex: RegExp;
  normalize: (m: string) => string;
  validate: (v: string) => boolean;
}

const B = '(?<![A-Za-z0-9Ññ])';
const E = '(?![A-Za-z0-9Ññ])';

const PATTERNS: Pattern[] = [
  {
    type: 'curp',
    regex: new RegExp(
      `${B}[A-Za-z][AEIOUXaeioux][A-Za-z]{2}\\d{6}[HMXhmx][A-Za-z]{5}[A-Za-z\\d]\\d${E}`,
      'g',
    ),
    normalize: (m) => m.toUpperCase(),
    validate: curpValid,
  },
  {
    type: 'rfc',
    regex: new RegExp(`${B}[A-Za-zÑñ&]{3,4}\\d{6}[A-Za-z\\d]{3}${E}`, 'g'),
    normalize: (m) => m.toUpperCase(),
    validate: rfcValid,
  },
  {
    type: 'clabe',
    regex: new RegExp(`${B}\\d{3}[ -]?\\d{3}[ -]?\\d{11}[ -]?\\d${E}`, 'g'),
    normalize: (m) => m.replace(/[ -]/g, ''),
    validate: clabeValid,
  },
  {
    type: 'card',
    regex: new RegExp(`${B}\\d{4}(?:[ -]?\\d{4}){2}[ -]?\\d{1,7}${E}`, 'g'),
    normalize: (m) => m.replace(/[ -]/g, ''),
    validate: (v) => v.length >= 13 && v.length <= 19 && luhnValid(v) && !/^(\d)\1+$/.test(v),
  },
  {
    type: 'nss',
    regex: new RegExp(`${B}\\d{11}${E}`, 'g'),
    normalize: (m) => m,
    validate: (v) => nssValid(v) && !/^(\d)\1+$/.test(v),
  },
];

/** Column headers that suggest payroll data. */
const SALARY_HEADER =
  /(sueldo|salario|salary|wage|n[oó]mina|payroll|percepci[oó]n|deducci[oó]n|neto|bruto|compensaci[oó]n|bono|comisi[oó]n|sdi|isr)/i;

const MAX_SAMPLES = 3;

export function maskValue(v: string): string {
  if (v.length <= 4) return '*'.repeat(v.length);
  return `${v.slice(0, 2)}${'*'.repeat(v.length - 4)}${v.slice(-2)}`;
}

/** Scans free text (ticket bodies, plain-text/CSV attachments). */
export function detectSensitiveText(text: string): SensitiveReport {
  const found = new Map<SensitiveType, { count: number; samples: string[] }>();
  // Track consumed spans so a CLABE is not also counted as a card, etc.
  const consumed: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => consumed.some(([a, b]) => s < b && e > a);

  for (const p of PATTERNS) {
    p.regex.lastIndex = 0;
    for (const m of text.matchAll(p.regex)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      const value = p.normalize(m[0]);
      if (!p.validate(value)) continue;
      consumed.push([start, end]);
      const entry = found.get(p.type) ?? { count: 0, samples: [] };
      entry.count++;
      if (entry.samples.length < MAX_SAMPLES) entry.samples.push(maskValue(value));
      found.set(p.type, entry);
    }
  }
  return toReport(found);
}

/** Scans tabular data (CSV/XLSX rows). The first row is treated as a header. */
export function detectSensitiveTable(rows: ReadonlyArray<ReadonlyArray<unknown>>): SensitiveReport {
  const found = new Map<SensitiveType, { count: number; samples: string[] }>();
  const header = rows[0] ?? [];
  const salaryCols = header
    .map((h, i) => ({ h: String(h ?? ''), i }))
    .filter(({ h }) => SALARY_HEADER.test(h));
  if (salaryCols.length > 0 && rows.length > 1) {
    found.set('salary_column', {
      count: salaryCols.length,
      samples: salaryCols.slice(0, MAX_SAMPLES).map(({ h }) => h),
    });
  }
  const text = rows.map((r) => r.map((c) => String(c ?? '')).join('\t')).join('\n');
  const textReport = detectSensitiveText(text);
  for (const f of textReport.findings) found.set(f.type, { count: f.count, samples: f.samples });
  return toReport(found);
}

/** Replaces every detected value with a type label, e.g. "[CURP REDACTADO]". */
export function redactSensitiveText(
  text: string,
  label = (t: SensitiveType) => `[${t.toUpperCase()} REDACTADO]`,
): string {
  const spans: Array<{ start: number; end: number; type: SensitiveType }> = [];
  const overlaps = (s: number, e: number) => spans.some((x) => s < x.end && e > x.start);
  for (const p of PATTERNS) {
    p.regex.lastIndex = 0;
    for (const m of text.matchAll(p.regex)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (overlaps(start, end) || !p.validate(p.normalize(m[0]))) continue;
      spans.push({ start, end, type: p.type });
    }
  }
  spans.sort((a, b) => b.start - a.start);
  let out = text;
  for (const s of spans) out = out.slice(0, s.start) + label(s.type) + out.slice(s.end);
  return out;
}

function toReport(
  found: Map<SensitiveType, { count: number; samples: string[] }>,
): SensitiveReport {
  const findings = [...found.entries()].map(([type, v]) => ({ type, ...v }));
  return { hasSensitiveData: findings.length > 0, findings };
}
