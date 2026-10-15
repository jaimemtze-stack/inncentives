import { z } from 'zod';
import { easterSunday, mexicanHolidays } from './holidays-mx';
import {
  addDays,
  assertValidTimeZone,
  compareLocalDate,
  formatLocalDate,
  fromZoned,
  type LocalDate,
  parseLocalDate,
  toZoned,
  weekday,
} from './timezone';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'HH:MM');

export const workIntervalSchema = z
  .object({ start: hhmm, end: hhmm })
  .refine((i) => i.start < i.end, { message: 'start must be before end' });

export const weekdayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type WeekdayKey = (typeof weekdayKeys)[number];

export const businessCalendarSchema = z.object({
  name: z.string().min(1).max(120),
  timezone: z.string().refine(
    (tz) => {
      try {
        assertValidTimeZone(tz);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid IANA timezone' },
  ),
  businessHours: z.record(z.enum(weekdayKeys), z.array(workIntervalSchema).max(4)),
  /** Built-in holiday rule sets. */
  holidayRules: z.array(z.enum(['MX'])).default(['MX']),
  /** Optional movable company days (non-statutory). */
  optionalRules: z.array(z.enum(['holy_thursday', 'holy_friday'])).default([]),
  /** Extra non-working days, YYYY-MM-DD. */
  extraHolidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
  /** Built-in holidays that are worked anyway, YYYY-MM-DD. */
  excludedHolidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
});

export type BusinessCalendarConfig = z.infer<typeof businessCalendarSchema>;

/** Default calendar: America/Mexico_City, Mon–Fri 09:00–18:30, Mexican statutory holidays. */
export const DEFAULT_MX_CALENDAR: BusinessCalendarConfig = {
  name: 'México — horario estándar',
  timezone: 'America/Mexico_City',
  businessHours: {
    mon: [{ start: '09:00', end: '18:30' }],
    tue: [{ start: '09:00', end: '18:30' }],
    wed: [{ start: '09:00', end: '18:30' }],
    thu: [{ start: '09:00', end: '18:30' }],
    fri: [{ start: '09:00', end: '18:30' }],
  },
  holidayRules: ['MX'],
  optionalRules: [],
  extraHolidays: [],
  excludedHolidays: [],
};

export interface Interval {
  start: number; // epoch ms
  end: number; // epoch ms, exclusive
}

const MAX_DAYS_SCAN = 366 * 5;

export class BusinessCalendar {
  private readonly holidayCache = new Map<number, Set<string>>();
  private readonly extra: Set<string>;
  private readonly excluded: Set<string>;

  constructor(readonly config: BusinessCalendarConfig) {
    businessCalendarSchema.parse(config);
    this.extra = new Set(config.extraHolidays);
    this.excluded = new Set(config.excludedHolidays);
    for (const d of [...this.extra, ...this.excluded]) parseLocalDate(d);
  }

  holidaysOf(year: number): Set<string> {
    let set = this.holidayCache.get(year);
    if (!set) {
      set = new Set<string>();
      if (this.config.holidayRules.includes('MX')) {
        for (const h of mexicanHolidays(year)) set.add(h.date);
      }
      const easter = easterSunday(year);
      if (this.config.optionalRules.includes('holy_thursday'))
        set.add(formatLocalDate(addDays(easter, -3)));
      if (this.config.optionalRules.includes('holy_friday'))
        set.add(formatLocalDate(addDays(easter, -2)));
      this.holidayCache.set(year, set);
    }
    return set;
  }

  isHoliday(d: LocalDate): boolean {
    const key = formatLocalDate(d);
    if (this.extra.has(key)) return true;
    if (this.excluded.has(key)) return false;
    return this.holidaysOf(d.year).has(key);
  }

  /** Working intervals (UTC ms) for a local calendar day. */
  intervalsForDay(d: LocalDate): Interval[] {
    if (this.isHoliday(d)) return [];
    const key = weekdayKeys[weekday(d)] as WeekdayKey;
    const hours = this.config.businessHours[key] ?? [];
    return hours.map((h) => ({
      start: this.localTime(d, h.start),
      end: this.localTime(d, h.end),
    }));
  }

  private localTime(d: LocalDate, hm: string): number {
    if (hm === '24:00') return fromZoned(addDays(d, 1), this.config.timezone).getTime();
    const [h, m] = hm.split(':').map(Number) as [number, number];
    return fromZoned({ ...d, hour: h, minute: m }, this.config.timezone).getTime();
  }

  localDateOf(instant: Date | number): LocalDate {
    const z = toZoned(new Date(instant), this.config.timezone);
    return { year: z.year, month: z.month, day: z.day };
  }

  isBusinessTime(instant: Date): boolean {
    const t = instant.getTime();
    return this.intervalsForDay(this.localDateOf(t)).some((i) => t >= i.start && t < i.end);
  }

  /** Business milliseconds in [from, to), excluding the given intervals (e.g. SLA pauses). */
  businessMsBetween(from: Date, to: Date, exclusions: Interval[] = []): number {
    const a = from.getTime();
    const b = to.getTime();
    if (b <= a) return 0;
    let total = 0;
    let day = this.localDateOf(a);
    const last = this.localDateOf(b);
    while (compareLocalDate(day, last) <= 0) {
      for (const iv of subtract(this.intervalsForDay(day), exclusions)) {
        const s = Math.max(iv.start, a);
        const e = Math.min(iv.end, b);
        if (e > s) total += e - s;
      }
      day = addDays(day, 1);
    }
    return total;
  }

  /**
   * Instant reached after consuming `ms` business milliseconds from `from`,
   * skipping exclusions. Returns null if not reachable within the scan horizon.
   */
  addBusinessMs(from: Date, ms: number, exclusions: Interval[] = []): Date | null {
    const a = from.getTime();
    if (ms <= 0) return new Date(a);
    let remaining = ms;
    let day = this.localDateOf(a);
    for (let i = 0; i < MAX_DAYS_SCAN; i++) {
      for (const iv of subtract(this.intervalsForDay(day), exclusions)) {
        const s = Math.max(iv.start, a);
        if (iv.end <= s) continue;
        const available = iv.end - s;
        if (available >= remaining) return new Date(s + remaining);
        remaining -= available;
      }
      day = addDays(day, 1);
    }
    return null;
  }

  businessMinutesBetween(from: Date, to: Date, exclusions: Interval[] = []): number {
    return this.businessMsBetween(from, to, exclusions) / 60_000;
  }

  addBusinessMinutes(from: Date, minutes: number, exclusions: Interval[] = []): Date | null {
    return this.addBusinessMs(from, minutes * 60_000, exclusions);
  }
}

/** Subtracts `cut` intervals from `base` intervals. Both sorted or not; output sorted. */
export function subtract(base: Interval[], cut: Interval[]): Interval[] {
  let result = base.filter((i) => i.end > i.start).sort((x, y) => x.start - y.start);
  for (const c of cut) {
    if (c.end <= c.start) continue;
    const next: Interval[] = [];
    for (const r of result) {
      if (c.end <= r.start || c.start >= r.end) {
        next.push(r);
        continue;
      }
      if (c.start > r.start) next.push({ start: r.start, end: c.start });
      if (c.end < r.end) next.push({ start: c.end, end: r.end });
    }
    result = next;
  }
  return result;
}
