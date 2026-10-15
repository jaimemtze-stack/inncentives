/**
 * CSV/XLSX formula-injection protection (OWASP "CSV Injection").
 * Cells starting with = + - @ (or tab/CR) are prefixed with a single quote.
 */
const DANGEROUS_START = /^[=+\-@\t\r]/;

export function neutralizeFormula(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  return DANGEROUS_START.test(s) ? `'${s}` : s;
}

export function escapeCsvCell(value: unknown, delimiter = ','): string {
  const s = neutralizeFormula(value);
  if (s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>, delimiter = ','): string {
  return rows.map((r) => r.map((c) => escapeCsvCell(c, delimiter)).join(delimiter)).join('\r\n');
}
