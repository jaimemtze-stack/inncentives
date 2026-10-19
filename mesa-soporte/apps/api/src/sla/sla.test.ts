import { describe, expect, it } from 'vitest';
import { BusinessCalendar, DEFAULT_MEXICO_CALENDAR } from './calendar';
import { computeSlaDues } from './sla';

const cal = new BusinessCalendar(DEFAULT_MEXICO_CALENDAR);
const mx = (iso: string) => new Date(`${iso}-06:00`);
const targets = { firstResponseMinutes: 60, updateMinutes: 120, solutionMinutes: 480 };
const opts = { pauseOnPending: true, warnPercent: 80 };
const base = {
  state: 'new',
  createdAt: mx('2026-10-19T10:00:00'),
  firstResponseAt: null,
  lastCustomerContactAt: mx('2026-10-19T10:00:00'),
  lastAgentContactAt: null,
  slaPausedMinutes: 0,
};

describe('computeSlaDues', () => {
  it('computes first response and solution in business time, with warning at 80 %', () => {
    const d = computeSlaDues(base, targets, cal, opts);
    expect(d.firstResponseDueAt?.toISOString()).toBe(mx('2026-10-19T11:00:00').toISOString());
    expect(d.solutionDueAt?.toISOString()).toBe(mx('2026-10-19T18:00:00').toISOString());
    expect(d.updateDueAt).toBeNull(); // no first response yet
    expect(d.escalationAt?.toISOString()).toBe(d.firstResponseDueAt?.toISOString());
    expect(d.slaWarningAt?.toISOString()).toBe(mx('2026-10-19T10:48:00').toISOString());
  });

  it('after the first answer, tracks updates only while the customer waits', () => {
    const answered = {
      ...base,
      state: 'open',
      firstResponseAt: mx('2026-10-19T10:30:00'),
      lastAgentContactAt: mx('2026-10-19T10:30:00'),
    };
    expect(computeSlaDues(answered, targets, cal, opts).updateDueAt).toBeNull();
    const customerReplied = { ...answered, lastCustomerContactAt: mx('2026-10-19T17:30:00') };
    // 60 business minutes left today (till 18:30), 60 more next day.
    expect(computeSlaDues(customerReplied, targets, cal, opts).updateDueAt?.toISOString()).toBe(
      mx('2026-10-20T10:00:00').toISOString(),
    );
  });

  it('pauses while pending and shifts the solution by the paused business minutes', () => {
    expect(
      computeSlaDues({ ...base, state: 'pending_reminder' }, targets, cal, opts).escalationAt,
    ).toBeNull();
    const resumed = computeSlaDues(
      { ...base, state: 'open', firstResponseAt: base.createdAt, slaPausedMinutes: 120 },
      targets,
      cal,
      opts,
    );
    expect(resumed.solutionDueAt?.toISOString()).toBe(mx('2026-10-20T10:30:00').toISOString());
  });

  it('stops for resolved/closed tickets and when no targets apply', () => {
    expect(
      computeSlaDues({ ...base, state: 'closed' }, targets, cal, opts).escalationAt,
    ).toBeNull();
    expect(
      computeSlaDues(
        base,
        { firstResponseMinutes: null, updateMinutes: null, solutionMinutes: null },
        cal,
        opts,
      ).escalationAt,
    ).toBeNull();
  });
});
