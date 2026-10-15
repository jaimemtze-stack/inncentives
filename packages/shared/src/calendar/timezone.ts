/**
 * Minimal, dependency-free timezone helpers based on Intl.
 * Works for any IANA zone, including zones with DST.
 */

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function assertValidTimeZone(timeZone: string): void {
  // Throws RangeError for invalid zones.
  formatter(timeZone);
}

/** Wall-clock parts of an instant in the given zone. */
export function toZoned(date: Date, timeZone: string): LocalDateTime {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset (ms) of the zone at the given instant: local - UTC. */
function offsetAt(instantMs: number, timeZone: string): number {
  const z = toZoned(new Date(instantMs), timeZone);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Converts a wall-clock time in a zone to a UTC instant.
 * Non-existent local times (DST gaps) are shifted forward; ambiguous ones resolve to the earlier instant.
 */
export function fromZoned(local: LocalDate & Partial<LocalDateTime>, timeZone: string): Date {
  const naive = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour ?? 0,
    local.minute ?? 0,
    local.second ?? 0,
  );
  let guess = naive - offsetAt(naive, timeZone);
  const second = naive - offsetAt(guess, timeZone);
  if (second !== guess) guess = Math.min(guess, second);
  return new Date(guess);
}

export function addDays(d: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(d: LocalDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export function compareLocalDate(a: LocalDate, b: LocalDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function formatLocalDate(d: LocalDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

export function parseLocalDate(s: string): LocalDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid date "${s}", expected YYYY-MM-DD`);
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const check = addDays(d, 0);
  if (compareLocalDate(d, check) !== 0) throw new Error(`Invalid date "${s}"`);
  return d;
}
