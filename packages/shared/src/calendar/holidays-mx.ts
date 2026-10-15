import { formatLocalDate, type LocalDate, weekday } from './timezone';

/**
 * Mandatory rest days in Mexico (Ley Federal del Trabajo, art. 74).
 * Movable holidays are computed by rule, never stored as fixed dates.
 */

export type MxHolidayCode =
  | 'new_year'
  | 'constitution_day'
  | 'benito_juarez'
  | 'labor_day'
  | 'independence_day'
  | 'revolution_day'
  | 'christmas'
  | 'presidential_transition';

export interface Holiday {
  date: string; // YYYY-MM-DD
  code: string;
  name: { 'es-MX': string; en: string };
}

/** n-th (1-based) given weekday (0=Sun) of a month. */
export function nthWeekdayOfMonth(year: number, month: number, dow: number, n: number): LocalDate {
  const first: LocalDate = { year, month, day: 1 };
  const offset = (dow - weekday(first) + 7) % 7;
  return { year, month, day: 1 + offset + (n - 1) * 7 };
}

/**
 * Presidential transition day: Oct 1 every six years starting 2024 (reform of 2014),
 * and Dec 1 every six years up to 2018.
 */
export function presidentialTransition(year: number): LocalDate | null {
  if (year >= 2024 && (year - 2024) % 6 === 0) return { year, month: 10, day: 1 };
  if (year <= 2018 && (2018 - year) % 6 === 0) return { year, month: 12, day: 1 };
  return null;
}

export function mexicanHolidays(year: number): Holiday[] {
  const list: Array<[LocalDate, MxHolidayCode, string, string]> = [
    [{ year, month: 1, day: 1 }, 'new_year', 'Año Nuevo', "New Year's Day"],
    [
      nthWeekdayOfMonth(year, 2, 1, 1),
      'constitution_day',
      'Día de la Constitución',
      'Constitution Day',
    ],
    [
      nthWeekdayOfMonth(year, 3, 1, 3),
      'benito_juarez',
      'Natalicio de Benito Juárez',
      "Benito Juárez's Birthday",
    ],
    [{ year, month: 5, day: 1 }, 'labor_day', 'Día del Trabajo', 'Labor Day'],
    [
      { year, month: 9, day: 16 },
      'independence_day',
      'Día de la Independencia',
      'Independence Day',
    ],
    [nthWeekdayOfMonth(year, 11, 1, 3), 'revolution_day', 'Día de la Revolución', 'Revolution Day'],
    [{ year, month: 12, day: 25 }, 'christmas', 'Navidad', 'Christmas Day'],
  ];
  const transition = presidentialTransition(year);
  if (transition) {
    list.push([
      transition,
      'presidential_transition',
      'Transmisión del Poder Ejecutivo Federal',
      'Presidential Inauguration',
    ]);
  }
  return list
    .map(([d, code, es, en]) => ({ date: formatLocalDate(d), code, name: { 'es-MX': es, en } }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Easter Sunday (Gregorian, anonymous algorithm). Useful for optional Holy Thursday/Friday. */
export function easterSunday(year: number): LocalDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}
