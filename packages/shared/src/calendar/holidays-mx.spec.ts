import { describe, expect, it } from 'vitest';
import {
  easterSunday,
  mexicanHolidays,
  nthWeekdayOfMonth,
  presidentialTransition,
} from './holidays-mx';

const dates = (y: number) => mexicanHolidays(y).map((h) => h.date);

describe('mexicanHolidays', () => {
  it.each([
    [
      2024,
      [
        '2024-01-01',
        '2024-02-05',
        '2024-03-18',
        '2024-05-01',
        '2024-09-16',
        '2024-10-01',
        '2024-11-18',
        '2024-12-25',
      ],
    ],
    [
      2025,
      [
        '2025-01-01',
        '2025-02-03',
        '2025-03-17',
        '2025-05-01',
        '2025-09-16',
        '2025-11-17',
        '2025-12-25',
      ],
    ],
    [
      2026,
      [
        '2026-01-01',
        '2026-02-02',
        '2026-03-16',
        '2026-05-01',
        '2026-09-16',
        '2026-11-16',
        '2026-12-25',
      ],
    ],
    [
      2027,
      [
        '2027-01-01',
        '2027-02-01',
        '2027-03-15',
        '2027-05-01',
        '2027-09-16',
        '2027-11-15',
        '2027-12-25',
      ],
    ],
    [
      2028,
      [
        '2028-01-01',
        '2028-02-07',
        '2028-03-20',
        '2028-05-01',
        '2028-09-16',
        '2028-11-20',
        '2028-12-25',
      ],
    ],
    [
      2030,
      [
        '2030-01-01',
        '2030-02-04',
        '2030-03-18',
        '2030-05-01',
        '2030-09-16',
        '2030-10-01',
        '2030-11-18',
        '2030-12-25',
      ],
    ],
  ])('computes %i by rule', (year, expected) => {
    expect(dates(year)).toEqual(expected);
  });

  it('includes bilingual names', () => {
    const h = mexicanHolidays(2026).find((x) => x.code === 'benito_juarez');
    expect(h?.name['es-MX']).toContain('Juárez');
    expect(h?.name.en).toContain('Juárez');
  });
});

describe('presidentialTransition', () => {
  it('is Oct 1 every six years from 2024', () => {
    expect(presidentialTransition(2024)).toEqual({ year: 2024, month: 10, day: 1 });
    expect(presidentialTransition(2036)).toEqual({ year: 2036, month: 10, day: 1 });
    expect(presidentialTransition(2025)).toBeNull();
  });
  it('was Dec 1 every six years up to 2018', () => {
    expect(presidentialTransition(2018)).toEqual({ year: 2018, month: 12, day: 1 });
    expect(presidentialTransition(2012)).toEqual({ year: 2012, month: 12, day: 1 });
    expect(presidentialTransition(2020)).toBeNull();
  });
});

describe('helpers', () => {
  it('nthWeekdayOfMonth', () => {
    expect(nthWeekdayOfMonth(2026, 2, 1, 1)).toEqual({ year: 2026, month: 2, day: 2 });
    expect(nthWeekdayOfMonth(2026, 3, 1, 3)).toEqual({ year: 2026, month: 3, day: 16 });
  });
  it.each([
    [2024, 3, 31],
    [2025, 4, 20],
    [2026, 4, 5],
    [2027, 3, 28],
    [2030, 4, 21],
  ])('easterSunday(%i)', (year, month, day) => {
    expect(easterSunday(year)).toEqual({ year, month, day });
  });
});
