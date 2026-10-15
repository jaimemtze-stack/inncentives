import { describe, expect, it } from 'vitest';
import { BusinessCalendar, DEFAULT_MX_CALENDAR } from '../calendar/business-calendar';
import { fromZoned, parseLocalDate } from '../calendar/timezone';
import { STANDARD_PLAN_TARGETS, evaluateSla } from './sla';

const cal = new BusinessCalendar(DEFAULT_MX_CALENDAR);
const mx = (s: string) => {
  const [d, t = '00:00'] = s.split(' ');
  const [h, m] = t.split(':').map(Number);
  return fromZoned({ ...parseLocalDate(d!), hour: h, minute: m }, 'America/Mexico_City');
};
const critical = STANDARD_PLAN_TARGETS[4]; // 1h / 2h / 4h
const normal = STANDARD_PLAN_TARGETS[2];

describe('evaluateSla', () => {
  it('computes due dates in business time', () => {
    const r = evaluateSla(
      cal,
      critical,
      { createdAt: mx('2026-10-16 18:00') },
      mx('2026-10-16 18:05'),
    );
    expect(r.firstResponse.dueAt).toEqual(mx('2026-10-19 09:30'));
    expect(r.solution.dueAt).toEqual(mx('2026-10-19 12:30'));
    expect(r.firstResponse.status).toBe('ok');
    expect(r.update.status).toBe('not_applicable');
    expect(r.nextEscalationAt).toEqual(mx('2026-10-19 09:30'));
  });

  it('goes to warning at 80 % and breached at 100 %', () => {
    const t = { createdAt: mx('2026-10-15 09:00') };
    expect(evaluateSla(cal, critical, t, mx('2026-10-15 09:47')).firstResponse.status).toBe('ok');
    expect(evaluateSla(cal, critical, t, mx('2026-10-15 09:48')).firstResponse.status).toBe(
      'warning',
    );
    expect(evaluateSla(cal, critical, t, mx('2026-10-15 10:00')).firstResponse.status).toBe(
      'breached',
    );
    expect(evaluateSla(cal, critical, t, mx('2026-10-15 10:00')).worstStatus).toBe('breached');
    expect(
      evaluateSla(cal, critical, t, mx('2026-10-15 09:50'), { warningPercent: 90 }).firstResponse
        .status,
    ).toBe('ok');
  });

  it('a holiday does not consume SLA time', () => {
    const r = evaluateSla(
      cal,
      critical,
      { createdAt: mx('2026-09-15 18:00') },
      mx('2026-09-16 12:00'),
    );
    expect(r.firstResponse.status).toBe('ok');
    expect(r.firstResponse.elapsedMinutes).toBe(30);
  });

  it('marks met / breached after the fact', () => {
    const created = mx('2026-10-15 09:00');
    const ok = evaluateSla(
      cal,
      critical,
      { createdAt: created, firstResponseAt: mx('2026-10-15 09:30') },
      mx('2026-10-15 15:00'),
    );
    expect(ok.firstResponse.status).toBe('met');
    expect(ok.firstResponse.dueAt).toBeNull();
    const late = evaluateSla(
      cal,
      critical,
      { createdAt: created, firstResponseAt: mx('2026-10-15 11:00') },
      mx('2026-10-15 15:00'),
    );
    expect(late.firstResponse.status).toBe('breached');
  });

  it('update clock runs from the pending customer contact', () => {
    const r = evaluateSla(
      cal,
      normal,
      {
        createdAt: mx('2026-10-14 09:00'),
        firstResponseAt: mx('2026-10-14 10:00'),
        pendingCustomerContactAt: mx('2026-10-15 09:00'),
      },
      mx('2026-10-15 10:00'),
    );
    expect(r.update.status).toBe('ok');
    expect(r.update.dueAt).toEqual(mx('2026-10-15 17:00'));
    const answered = evaluateSla(
      cal,
      normal,
      { createdAt: mx('2026-10-14 09:00') },
      mx('2026-10-15 10:00'),
    );
    expect(answered.update.status).toBe('not_applicable');
  });

  it('pending states pause the solution clock', () => {
    const created = mx('2026-10-15 09:00');
    const pauses = [{ start: mx('2026-10-15 10:00'), end: mx('2026-10-15 12:00') }];
    const r = evaluateSla(
      cal,
      critical,
      { createdAt: created, firstResponseAt: mx('2026-10-15 09:10'), pauses },
      mx('2026-10-15 12:30'),
    );
    expect(r.solution.elapsedMinutes).toBe(90);
    expect(r.solution.dueAt).toEqual(mx('2026-10-15 15:00'));

    const open = evaluateSla(
      cal,
      critical,
      { createdAt: created, pauses: [{ start: mx('2026-10-15 10:00') }] },
      mx('2026-10-16 12:00'),
    );
    expect(open.solution.status).toBe('paused');
    expect(open.solution.dueAt).toBeNull();
    expect(open.solution.elapsedMinutes).toBe(60);

    const noPause = evaluateSla(
      cal,
      critical,
      { createdAt: created, pauses },
      mx('2026-10-15 12:30'),
      { pauseSolutionOnPending: false },
    );
    expect(noPause.solution.elapsedMinutes).toBe(210);
  });

  it('paused but already over target is breached', () => {
    const r = evaluateSla(
      cal,
      critical,
      { createdAt: mx('2026-10-15 09:00'), pauses: [{ start: mx('2026-10-15 14:00') }] },
      mx('2026-10-16 09:00'),
    );
    expect(r.solution.status).toBe('breached');
  });

  it('solved tickets stop the update metric', () => {
    const r = evaluateSla(
      cal,
      critical,
      {
        createdAt: mx('2026-10-15 09:00'),
        pendingCustomerContactAt: mx('2026-10-15 10:00'),
        solvedAt: mx('2026-10-15 11:00'),
      },
      mx('2026-10-15 12:00'),
    );
    expect(r.update.status).toBe('met');
    expect(r.solution.status).toBe('met');
  });

  it('untracked metrics are not applicable', () => {
    const r = evaluateSla(
      cal,
      { firstResponseMinutes: null, updateMinutes: null, solutionMinutes: null },
      { createdAt: mx('2026-10-15 09:00') },
      mx('2026-10-20 09:00'),
    );
    expect(r.worstStatus).toBe('not_applicable');
    expect(r.nextEscalationAt).toBeNull();
  });

  it('validates warningPercent', () => {
    expect(() =>
      evaluateSla(cal, critical, { createdAt: new Date() }, new Date(), { warningPercent: 0 }),
    ).toThrow(RangeError);
  });

  it('a priority change is evaluated with the new targets from the original creation time', () => {
    const t = { createdAt: mx('2026-10-15 09:00') };
    expect(evaluateSla(cal, normal, t, mx('2026-10-15 11:00')).firstResponse.status).toBe('ok');
    expect(evaluateSla(cal, critical, t, mx('2026-10-15 11:00')).firstResponse.status).toBe(
      'breached',
    );
  });
});
