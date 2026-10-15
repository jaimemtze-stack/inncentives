import { toZoned } from '../calendar/timezone';

/**
 * Ticket numbers: YYYYMMDD + zero-padded daily counter (default 4 digits), in the configured zone.
 * The counter itself is allocated atomically by the database.
 */
export function formatTicketNumber(
  date: Date,
  counter: number,
  timeZone = 'America/Mexico_City',
  counterDigits = 4,
): string {
  if (!Number.isInteger(counter) || counter < 1)
    throw new RangeError('counter must be a positive integer');
  const z = toZoned(date, timeZone);
  const day = `${z.year}${String(z.month).padStart(2, '0')}${String(z.day).padStart(2, '0')}`;
  const c = String(counter);
  if (c.length > counterDigits) throw new RangeError(`counter exceeds ${counterDigits} digits`);
  return day + c.padStart(counterDigits, '0');
}

export function ticketDayKey(date: Date, timeZone = 'America/Mexico_City'): string {
  return formatTicketNumber(date, 1, timeZone, 1).slice(0, 8);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds "[Ticket#202610130001] Original subject" without duplicating the tag. */
export function buildSubject(number: string, subject: string, prefix = 'Ticket#'): string {
  const clean = subject.replace(/[\r\n]+/g, ' ').trim();
  const tag = `[${prefix}${number}]`;
  return clean.includes(tag) ? clean : `${tag} ${clean}`.trim();
}

/** Extracts ticket numbers referenced in a subject, e.g. "RE: [Ticket#202610130001] …". */
export function parseTicketNumbers(subject: string, prefix = 'Ticket#'): string[] {
  const re = new RegExp(`\\[${escapeRegex(prefix)}\\s*(\\d{9,20})\\]`, 'gi');
  return [...new Set([...subject.matchAll(re)].map((m) => m[1]!))];
}
