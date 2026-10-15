import { z } from 'zod';
import type { BusinessCalendar, Interval } from '../calendar/business-calendar';

/** Targets in business minutes. Null = not tracked. */
export const slaTargetsSchema = z.object({
  firstResponseMinutes: z.number().int().positive().nullable(),
  updateMinutes: z.number().int().positive().nullable(),
  solutionMinutes: z.number().int().positive().nullable(),
});
export type SlaTargets = z.infer<typeof slaTargetsSchema>;

export type SlaMetric = 'first_response' | 'update' | 'solution';
export type SlaStatus = 'ok' | 'warning' | 'breached' | 'paused' | 'met' | 'not_applicable';

export interface SlaTimeline {
  createdAt: Date;
  /** First public agent reply. */
  firstResponseAt?: Date | null;
  /** Last public customer contact that still awaits an agent answer (null if the agent answered last). */
  pendingCustomerContactAt?: Date | null;
  /** When the ticket entered a resolved/closed state. */
  solvedAt?: Date | null;
  /**
   * Intervals during which the solution clock is paused (pending states).
   * An open-ended pause has `end` undefined.
   */
  pauses?: Array<{ start: Date; end?: Date | null }>;
}

export interface SlaMetricResult {
  metric: SlaMetric;
  status: SlaStatus;
  /** When the metric escalates (null if paused, met or not applicable). */
  dueAt: Date | null;
  /** When it enters the warning state. */
  warningAt: Date | null;
  /** Business minutes consumed so far (or until met). */
  elapsedMinutes: number;
  targetMinutes: number | null;
  /** Remaining business minutes (negative if breached). */
  remainingMinutes: number | null;
}

export interface SlaEvaluation {
  firstResponse: SlaMetricResult;
  update: SlaMetricResult;
  solution: SlaMetricResult;
  /** Earliest due date among open metrics, for sorting/escalation. */
  nextEscalationAt: Date | null;
  worstStatus: SlaStatus;
}

export interface SlaOptions {
  /** Percentage of the target at which the metric becomes "warning". Default 80. */
  warningPercent?: number;
  /** Whether pending states pause the solution clock. Default true. */
  pauseSolutionOnPending?: boolean;
}

const severity: Record<SlaStatus, number> = {
  not_applicable: 0,
  met: 1,
  paused: 2,
  ok: 3,
  warning: 4,
  breached: 5,
};

export function evaluateSla(
  calendar: BusinessCalendar,
  targets: SlaTargets,
  timeline: SlaTimeline,
  now: Date,
  options: SlaOptions = {},
): SlaEvaluation {
  const warningPercent = options.warningPercent ?? 80;
  const pauseOnPending = options.pauseSolutionOnPending ?? true;
  if (warningPercent <= 0 || warningPercent > 100)
    throw new RangeError('warningPercent must be in (0, 100]');

  const firstResponse = metric(
    calendar,
    'first_response',
    targets.firstResponseMinutes,
    timeline.createdAt,
    timeline.firstResponseAt ?? null,
    [],
    false,
    now,
    warningPercent,
  );

  const update =
    timeline.solvedAt || !timeline.pendingCustomerContactAt
      ? notApplicableOrMet(
          'update',
          targets.updateMinutes,
          timeline.pendingCustomerContactAt ? 'met' : 'not_applicable',
        )
      : metric(
          calendar,
          'update',
          targets.updateMinutes,
          timeline.pendingCustomerContactAt,
          null,
          [],
          false,
          now,
          warningPercent,
        );

  const pauses = pauseOnPending ? (timeline.pauses ?? []) : [];
  const openPause = pauses.some((p) => !p.end && p.start.getTime() <= now.getTime());
  const exclusions: Interval[] = pauses.map((p) => ({
    start: p.start.getTime(),
    end: (p.end ?? now).getTime(),
  }));
  const solution = metric(
    calendar,
    'solution',
    targets.solutionMinutes,
    timeline.createdAt,
    timeline.solvedAt ?? null,
    exclusions,
    openPause,
    now,
    warningPercent,
  );

  const all = [firstResponse, update, solution];
  const dues = all.map((m) => m.dueAt).filter((d): d is Date => d !== null);
  const nextEscalationAt = dues.length ? new Date(Math.min(...dues.map((d) => d.getTime()))) : null;
  const worstStatus = all.reduce<SlaStatus>(
    (w, m) => (severity[m.status] > severity[w] ? m.status : w),
    'not_applicable',
  );
  return { firstResponse, update, solution, nextEscalationAt, worstStatus };
}

function notApplicableOrMet(
  m: SlaMetric,
  target: number | null,
  status: SlaStatus,
): SlaMetricResult {
  return {
    metric: m,
    status: target === null ? 'not_applicable' : status,
    dueAt: null,
    warningAt: null,
    elapsedMinutes: 0,
    targetMinutes: target,
    remainingMinutes: null,
  };
}

function metric(
  calendar: BusinessCalendar,
  m: SlaMetric,
  target: number | null,
  start: Date,
  doneAt: Date | null,
  exclusions: Interval[],
  paused: boolean,
  now: Date,
  warningPercent: number,
): SlaMetricResult {
  if (target === null) return notApplicableOrMet(m, null, 'not_applicable');
  const end = doneAt && doneAt.getTime() <= now.getTime() ? doneAt : now;
  const elapsed = calendar.businessMinutesBetween(start, end, exclusions);
  const remaining = target - elapsed;

  if (doneAt && doneAt.getTime() <= now.getTime()) {
    return {
      metric: m,
      status: elapsed <= target ? 'met' : 'breached',
      dueAt: null,
      warningAt: null,
      elapsedMinutes: elapsed,
      targetMinutes: target,
      remainingMinutes: remaining,
    };
  }

  if (paused) {
    return {
      metric: m,
      status: remaining < 0 ? 'breached' : 'paused',
      dueAt: null,
      warningAt: null,
      elapsedMinutes: elapsed,
      targetMinutes: target,
      remainingMinutes: remaining,
    };
  }

  const dueAt = calendar.addBusinessMinutes(start, target, exclusions);
  const warningAt = calendar.addBusinessMinutes(start, (target * warningPercent) / 100, exclusions);
  let status: SlaStatus = 'ok';
  if (dueAt && now.getTime() >= dueAt.getTime()) status = 'breached';
  else if (warningAt && now.getTime() >= warningAt.getTime()) status = 'warning';
  return {
    metric: m,
    status,
    dueAt,
    warningAt,
    elapsedMinutes: elapsed,
    targetMinutes: target,
    remainingMinutes: remaining,
  };
}

/** Default "Estándar" plan (ADR-0007): response / solution in business hours. */
export const STANDARD_PLAN_TARGETS: Record<1 | 2 | 3 | 4, SlaTargets> = {
  4: { firstResponseMinutes: 60, updateMinutes: 120, solutionMinutes: 4 * 60 },
  3: { firstResponseMinutes: 2 * 60, updateMinutes: 4 * 60, solutionMinutes: 8 * 60 },
  2: { firstResponseMinutes: 4 * 60, updateMinutes: 8 * 60, solutionMinutes: 24 * 60 },
  1: { firstResponseMinutes: 8 * 60, updateMinutes: 16 * 60, solutionMinutes: 40 * 60 },
};
