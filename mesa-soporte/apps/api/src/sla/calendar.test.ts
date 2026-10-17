import { describe, expect, it } from 'vitest';
import {
  BusinessCalendar,
  DEFAULT_MEXICO_CALENDAR,
  mexicanStatutoryHolidays,
  zonedTimeToUtc,
} from './calendar';

const cal = new BusinessCalendar(DEFAULT_MEXICO_CALENDAR);
// Mexico City is UTC-6 all year since the 2022 DST abolition.
const mx = (iso: string) => new Date(`${iso}-06:00`);

describe('Mexican statutory holidays', () => {
  it('computes the movable Mondays by rule', () => {
    expect(mexicanStatutoryHolidays(2026)).toEqual([
      '2026-01-01',
      '2026-02-02',
      '2026-03-16',
      '2026-05-01',
      '2026-09-16',
      '2026-11-16',
      '2026-12-25',
    ]);
    expect(mexicanStatutoryHolidays(2027)).toContain('2027-02-01');
    expect(mexicanStatutoryHolidays(2027)).toContain('2027-03-15');
    expect(mexicanStatutoryHolidays(2027)).toContain('2027-11-15');
  });

  it('adds 1 October only in transmission years', () => {
    expect(mexicanStatutoryHolidays(2024)).toContain('2024-10-01');
    expect(mexicanStatutoryHolidays(2030)).toContain('2030-10-01');
    expect(mexicanStatutoryHolidays(2026)).not.toContain('2026-10-01');
  });
});

describe('BusinessCalendar (Mon–Fri 09:00–18:30, America/Mexico_City)', () => {
  it('adds minutes inside the same working day', () => {
    expect(cal.addBusinessMinutes(mx('2026-10-14T10:00:00'), 60).toISOString()).toBe(
      mx('2026-10-14T11:00:00').toISOString(),
    );
  });

  it('starts the clock at opening time when created at night', () => {
    expect(cal.addBusinessMinutes(mx('2026-10-14T22:00:00'), 30).toISOString()).toBe(
      mx('2026-10-15T09:30:00').toISOString(),
    );
  });

  it('skips weekends', () => {
    // Friday 18:00 + 60 business minutes = 30 on Friday + 30 on Monday.
    expect(cal.addBusinessMinutes(mx('2026-10-16T18:00:00'), 60).toISOString()).toBe(
      mx('2026-10-19T09:30:00').toISOString(),
    );
  });

  it('skips statutory holidays (Monday 16 November 2026)', () => {
    expect(cal.addBusinessMinutes(mx('2026-11-13T18:00:00'), 60).toISOString()).toBe(
      mx('2026-11-17T09:30:00').toISOString(),
    );
  });

  it('honours custom holidays (Holy Thursday)', () => {
    const c = new BusinessCalendar({ ...DEFAULT_MEXICO_CALENDAR, holidays: ['2027-03-25'] });
    expect(c.addBusinessMinutes(mx('2027-03-24T18:30:00'), 10).toISOString()).toBe(
      mx('2027-03-26T09:10:00').toISOString(),
    );
  });

  it('spans several days: 40 business hours from Monday 09:00', () => {
    // 9.5 h per day: 4 days = 38 h, + 2 h on Friday.
    expect(cal.addBusinessMinutes(mx('2026-10-19T09:00:00'), 40 * 60).toISOString()).toBe(
      mx('2026-10-23T11:00:00').toISOString(),
    );
  });

  it('measures business minutes between instants', () => {
    expect(cal.businessMinutesBetween(mx('2026-10-16T18:00:00'), mx('2026-10-19T09:30:00'))).toBe(60);
    expect(cal.businessMinutesBetween(mx('2026-10-17T10:00:00'), mx('2026-10-18T10:00:00'))).toBe(0);
    expect(cal.businessMinutesBetween(mx('2026-10-14T10:00:00'), mx('2026-10-14T09:00:00'))).toBe(0);
  });

  it('is consistent: between(start, add(start, n)) == n', () => {
    const start = mx('2026-12-23T17:00:00');
    for (const n of [1, 59, 90, 600, 2400]) {
      expect(cal.businessMinutesBetween(start, cal.addBusinessMinutes(start, n))).toBe(n);
    }
  });

  it('handles zones with daylight saving time', () => {
    // New York: 2026-03-08 02:00 jumps to 03:00 (UTC-5 -> UTC-4).
    expect(zonedTimeToUtc(2026, 3, 9, 9, 0, 'America/New_York').toISOString()).toBe('2026-03-09T13:00:00.000Z');
    expect(zonedTimeToUtc(2026, 3, 6, 9, 0, 'America/New_York').toISOString()).toBe('2026-03-06T14:00:00.000Z');
    const ny = new BusinessCalendar({ ...DEFAULT_MEXICO_CALENDAR, timezone: 'America/New_York', mexicoStatutory: false });
    // Friday 18:00 EST + 60 = Monday 09:30 EDT.
    expect(ny.addBusinessMinutes(new Date('2026-03-06T23:00:00Z'), 60).toISOString()).toBe('2026-03-09T13:30:00.000Z');
  });

  it('rejects invalid definitions', () => {
    expect(() => new BusinessCalendar({ ...DEFAULT_MEXICO_CALENDAR, timezone: 'Mars/Olympus' })).toThrow();
    expect(() => new BusinessCalendar({ ...DEFAULT_MEXICO_CALENDAR, hours: { 1: [['18:00', '09:00']] } })).toThrow();
    expect(() => new BusinessCalendar({ ...DEFAULT_MEXICO_CALENDAR, holidays: ['25/12/2026'] })).toThrow();
  });
});
