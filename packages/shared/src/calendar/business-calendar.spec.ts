import { describe, expect, it } from 'vitest';
import {
  BusinessCalendar,
  DEFAULT_MX_CALENDAR,
  businessCalendarSchema,
  subtract,
} from './business-calendar';
import { fromZoned, parseLocalDate, toZoned } from './timezone';

const cal = new BusinessCalendar(DEFAULT_MX_CALENDAR);
const mx = (s: string) => {
  const [d, t = '00:00'] = s.split(' ');
  const ld = parseLocalDate(d!);
  const [h, m] = t.split(':').map(Number);
  return fromZoned({ ...ld, hour: h, minute: m }, 'America/Mexico_City');
};
const fmt = (d: Date | null) => {
  if (!d) return null;
  const z = toZoned(d, 'America/Mexico_City');
  const p = (n: number) => String(n).padStart(2, '0');
  return `${z.year}-${p(z.month)}-${p(z.day)} ${p(z.hour)}:${p(z.minute)}`;
};

describe('BusinessCalendar (default MX)', () => {
  it('Mexico City is UTC-6 (no DST since 2022)', () => {
    expect(mx('2026-07-01 09:00').toISOString()).toBe('2026-07-01T15:00:00.000Z');
    expect(mx('2026-01-15 09:00').toISOString()).toBe('2026-01-15T15:00:00.000Z');
  });

  it('knows business time, weekends and holidays', () => {
    expect(cal.isBusinessTime(mx('2026-10-15 10:00'))).toBe(true); // Thursday
    expect(cal.isBusinessTime(mx('2026-10-15 18:30'))).toBe(false); // end is exclusive
    expect(cal.isBusinessTime(mx('2026-10-15 08:59'))).toBe(false);
    expect(cal.isBusinessTime(mx('2026-10-17 10:00'))).toBe(false); // Saturday
    expect(cal.isBusinessTime(mx('2026-09-16 10:00'))).toBe(false); // Independence day
    expect(cal.isBusinessTime(mx('2026-11-16 10:00'))).toBe(false); // 3rd Monday Nov
  });

  it('counts business minutes across a weekend', () => {
    // Fri 17:30 → Mon 10:00 = 60 + 60 = 120
    expect(cal.businessMinutesBetween(mx('2026-10-16 17:30'), mx('2026-10-19 10:00'))).toBe(120);
  });

  it('a full business day is 570 minutes', () => {
    expect(cal.businessMinutesBetween(mx('2026-10-15 00:00'), mx('2026-10-16 00:00'))).toBe(570);
  });

  it('returns 0 for inverted ranges', () => {
    expect(cal.businessMinutesBetween(mx('2026-10-16 00:00'), mx('2026-10-15 00:00'))).toBe(0);
  });

  it('adds business minutes skipping nights, weekends and holidays', () => {
    expect(fmt(cal.addBusinessMinutes(mx('2026-10-15 17:00'), 120))).toBe('2026-10-16 09:30');
    expect(fmt(cal.addBusinessMinutes(mx('2026-10-16 18:00'), 60))).toBe('2026-10-19 09:30');
    // Friday Sep 11 → Monday Sep 14 → Tue 15 → (Wed 16 holiday) → Thu 17
    expect(fmt(cal.addBusinessMinutes(mx('2026-09-15 18:00'), 60))).toBe('2026-09-17 09:30');
    // Starting at night counts from next opening
    expect(fmt(cal.addBusinessMinutes(mx('2026-10-15 22:00'), 30))).toBe('2026-10-16 09:30');
    expect(fmt(cal.addBusinessMinutes(mx('2026-10-15 10:00'), 0))).toBe('2026-10-15 10:00');
  });

  it('skips the Dec 25 – Jan 1 holidays', () => {
    expect(fmt(cal.addBusinessMinutes(mx('2026-12-24 18:00'), 60))).toBe('2026-12-28 09:30');
    expect(fmt(cal.addBusinessMinutes(mx('2026-12-31 18:00'), 60))).toBe('2027-01-04 09:30');
  });

  it('round-trips add/between', () => {
    const start = mx('2026-10-14 11:17');
    for (const minutes of [1, 59, 570, 1000, 2400]) {
      const end = cal.addBusinessMinutes(start, minutes)!;
      expect(cal.businessMinutesBetween(start, end)).toBe(minutes);
    }
  });

  it('honours exclusions (pauses)', () => {
    const start = mx('2026-10-15 09:00');
    const pause = [
      { start: mx('2026-10-15 10:00').getTime(), end: mx('2026-10-15 12:00').getTime() },
    ];
    expect(fmt(cal.addBusinessMinutes(start, 120, pause))).toBe('2026-10-15 13:00');
    expect(cal.businessMinutesBetween(start, mx('2026-10-15 13:00'), pause)).toBe(120);
  });

  it('returns null when a target is unreachable (no business hours)', () => {
    const never = new BusinessCalendar({ ...DEFAULT_MX_CALENDAR, businessHours: {} });
    expect(never.addBusinessMinutes(mx('2026-10-15 09:00'), 10)).toBeNull();
  });
});

describe('calendar configuration', () => {
  it('supports extra and excluded holidays and Holy Week rules', () => {
    const c = new BusinessCalendar({
      ...DEFAULT_MX_CALENDAR,
      optionalRules: ['holy_thursday', 'holy_friday'],
      extraHolidays: ['2026-10-15'],
      excludedHolidays: ['2026-11-16'],
    });
    expect(c.isHoliday(parseLocalDate('2026-04-02'))).toBe(true);
    expect(c.isHoliday(parseLocalDate('2026-04-03'))).toBe(true);
    expect(c.isHoliday(parseLocalDate('2026-10-15'))).toBe(true);
    expect(c.isHoliday(parseLocalDate('2026-11-16'))).toBe(false);
  });

  it('supports extended hours, split shifts and 24:00', () => {
    const c = new BusinessCalendar({
      ...DEFAULT_MX_CALENDAR,
      businessHours: {
        sat: [{ start: '00:00', end: '24:00' }],
        mon: [
          { start: '08:00', end: '12:00' },
          { start: '13:00', end: '20:00' },
        ],
      },
    });
    expect(c.businessMinutesBetween(mx('2026-10-17 00:00'), mx('2026-10-18 00:00'))).toBe(1440);
    expect(c.businessMinutesBetween(mx('2026-10-19 00:00'), mx('2026-10-20 00:00'))).toBe(660);
  });

  it('works with a DST zone', () => {
    const c = new BusinessCalendar({
      ...DEFAULT_MX_CALENDAR,
      timezone: 'America/Tijuana',
      holidayRules: [],
    });
    // US DST starts 2026-03-08; 09:00 local is UTC-8 before, UTC-7 after.
    const before = fromZoned({ year: 2026, month: 3, day: 6, hour: 9 }, 'America/Tijuana');
    const after = fromZoned({ year: 2026, month: 3, day: 9, hour: 9 }, 'America/Tijuana');
    expect(before.toISOString()).toBe('2026-03-06T17:00:00.000Z');
    expect(after.toISOString()).toBe('2026-03-09T16:00:00.000Z');
    expect(c.businessMinutesBetween(before, after)).toBe(570 * 1);
  });

  it('rejects invalid configuration', () => {
    expect(
      businessCalendarSchema.safeParse({ ...DEFAULT_MX_CALENDAR, timezone: 'Mars/Base' }).success,
    ).toBe(false);
    expect(
      () =>
        new BusinessCalendar({
          ...DEFAULT_MX_CALENDAR,
          businessHours: { mon: [{ start: '10:00', end: '09:00' }] },
        }),
    ).toThrow();
    expect(
      () => new BusinessCalendar({ ...DEFAULT_MX_CALENDAR, extraHolidays: ['2026-02-30'] }),
    ).toThrow();
    expect(() => parseLocalDate('15/10/2026')).toThrow();
  });
});

describe('subtract', () => {
  it('cuts intervals', () => {
    expect(subtract([{ start: 0, end: 10 }], [{ start: 3, end: 5 }])).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 10 },
    ]);
    expect(subtract([{ start: 0, end: 10 }], [{ start: -5, end: 20 }])).toEqual([]);
    expect(subtract([{ start: 0, end: 10 }], [{ start: 5, end: 5 }])).toEqual([
      { start: 0, end: 10 },
    ]);
  });
});
