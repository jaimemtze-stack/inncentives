/**
 * Business-hours arithmetic for SLAs. Works in any IANA time zone without
 * external libraries (Intl API) and knows the Mexican statutory holidays
 * (Ley Federal del Trabajo, art. 74), computed by rule for any year.
 */

export type WeekdayHours = Array<[string, string]>; // [["09:00","18:30"]]

export interface CalendarDefinition {
  timezone: string;
  /** Index 0 = Sunday … 6 = Saturday. */
  hours: Record<number, WeekdayHours>;
  /** Extra non-working dates, YYYY-MM-DD in the calendar's time zone. */
  holidays: string[];
  /** Add the Mexican statutory holidays automatically. */
  mexicoStatutory: boolean;
}

export const DEFAULT_MEXICO_CALENDAR: CalendarDefinition = {
  timezone: 'America/Mexico_City',
  hours: {
    1: [['09:00', '18:30']],
    2: [['09:00', '18:30']],
    3: [['09:00', '18:30']],
    4: [['09:00', '18:30']],
    5: [['09:00', '18:30']],
  },
  holidays: [],
  mexicoStatutory: true,
};

const MINUTE = 60_000;
const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** n-th (1-based) given weekday (0=Sun) of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** Mexican statutory rest days (LFT art. 74) for a year. */
export function mexicanStatutoryHolidays(year: number): string[] {
  const days = [
    isoDate(year, 1, 1),
    isoDate(year, 2, nthWeekday(year, 2, 1, 1)), // first Monday of February
    isoDate(year, 3, nthWeekday(year, 3, 1, 3)), // third Monday of March
    isoDate(year, 5, 1),
    isoDate(year, 9, 16),
    isoDate(year, 11, nthWeekday(year, 11, 1, 3)), // third Monday of November
    isoDate(year, 12, 25),
  ];
  // Transmission of the Federal Executive: 1 October every six years (2024, 2030, …).
  if (year >= 2024 && (year - 2024) % 6 === 0) days.push(isoDate(year, 10, 1));
  return days.sort();
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = Object.fromEntries(
    formatter(tz)
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMs(instant: number, tz: string): number {
  const p = zonedParts(new Date(instant), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Converts a wall-clock time in `tz` to a UTC instant (handles DST shifts). */
export function zonedTimeToUtc(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetMs(guess, tz);
  const second = guess - offsetMs(t, tz);
  if (second !== t) t = second;
  return new Date(t);
}

export function validateCalendar(cal: CalendarDefinition): void {
  // Throws RangeError for unknown time zones.
  formatter(cal.timezone).format(new Date());
  for (const [day, intervals] of Object.entries(cal.hours)) {
    const n = Number(day);
    if (!Number.isInteger(n) || n < 0 || n > 6) throw new Error(`Invalid weekday ${day}`);
    for (const [from, to] of intervals) {
      if (
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(from) ||
        !/^([01]\d|2[0-4]):[0-5]\d$/.test(to) ||
        from >= to
      ) {
        throw new Error(`Invalid interval ${from}-${to}`);
      }
    }
  }
  for (const h of cal.holidays)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h)) throw new Error(`Invalid holiday ${h}`);
}

export class BusinessCalendar {
  private readonly holidayCache = new Map<number, Set<string>>();

  constructor(private readonly def: CalendarDefinition) {
    validateCalendar(def);
  }

  isHoliday(dateIso: string): boolean {
    const year = Number(dateIso.slice(0, 4));
    let set = this.holidayCache.get(year);
    if (!set) {
      set = new Set(this.def.holidays.filter((h) => h.startsWith(`${year}-`)));
      if (this.def.mexicoStatutory) for (const h of mexicanStatutoryHolidays(year)) set.add(h);
      this.holidayCache.set(year, set);
    }
    return set.has(dateIso);
  }

  /** Working intervals (UTC instants) of a local calendar date. */
  intervalsFor(y: number, m: number, d: number): Array<{ start: number; end: number }> {
    if (this.isHoliday(isoDate(y, m, d))) return [];
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return (this.def.hours[weekday] ?? []).map(([from, to]) => {
      const [fh, fm] = from.split(':').map(Number) as [number, number];
      const [th, tm] = to.split(':').map(Number) as [number, number];
      return {
        start: zonedTimeToUtc(y, m, d, fh, fm, this.def.timezone).getTime(),
        end: zonedTimeToUtc(y, m, d, th, tm, this.def.timezone).getTime(),
      };
    });
  }

  private *days(from: Date, maxDays = 800): Generator<[number, number, number]> {
    const p = zonedParts(from, this.def.timezone);
    const base = Date.UTC(p.year, p.month - 1, p.day);
    for (let i = 0; i < maxDays; i++) {
      const dt = new Date(base + i * 86_400_000);
      yield [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
    }
  }

  /** The instant reached after `minutes` business minutes from `start`. */
  addBusinessMinutes(start: Date, minutes: number): Date {
    if (minutes <= 0) return new Date(start);
    let remaining = minutes * MINUTE;
    const from = start.getTime();
    for (const [y, m, d] of this.days(start)) {
      for (const iv of this.intervalsFor(y, m, d)) {
        const s = Math.max(from, iv.start);
        if (s >= iv.end) continue;
        const available = iv.end - s;
        if (remaining <= available) return new Date(s + remaining);
        remaining -= available;
      }
    }
    throw new Error('Calendar has no working time in the next 800 days');
  }

  /** Business minutes between two instants (0 if b <= a). */
  businessMinutesBetween(a: Date, b: Date): number {
    if (b <= a) return 0;
    let total = 0;
    const from = a.getTime();
    const to = b.getTime();
    for (const [y, m, d] of this.days(a)) {
      const dayStart = zonedTimeToUtc(y, m, d, 0, 0, this.def.timezone).getTime();
      if (dayStart >= to) break;
      for (const iv of this.intervalsFor(y, m, d)) {
        const s = Math.max(from, iv.start);
        const e = Math.min(to, iv.end);
        if (e > s) total += e - s;
      }
    }
    return Math.round(total / MINUTE);
  }
}
