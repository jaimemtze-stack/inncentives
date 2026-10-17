import { PendingStates } from '@mesa/shared';
import type { BusinessCalendar } from './calendar';

export interface SlaTargets {
  firstResponseMinutes: number | null;
  updateMinutes: number | null;
  solutionMinutes: number | null;
}

export interface SlaTicketState {
  state: string;
  createdAt: Date;
  firstResponseAt: Date | null;
  lastCustomerContactAt: Date | null;
  lastAgentContactAt: Date | null;
  slaPausedMinutes: number;
}

export interface SlaDues {
  firstResponseDueAt: Date | null;
  updateDueAt: Date | null;
  solutionDueAt: Date | null;
  escalationAt: Date | null;
  slaWarningAt: Date | null;
}

const NONE: SlaDues = { firstResponseDueAt: null, updateDueAt: null, solutionDueAt: null, escalationAt: null, slaWarningAt: null };
const CLOSED_STATES = ['resolved', 'closed', 'merged'];

/**
 * Due dates of a ticket under an SLA. Clocks only run in business time.
 * - First response: from creation until the first public agent answer.
 * - Update: from the last customer contact while the customer waits.
 * - Solution: from creation, shifted by the business minutes spent pending.
 * Pending states pause every clock when pauseOnPending is set.
 */
export function computeSlaDues(
  t: SlaTicketState,
  targets: SlaTargets,
  cal: BusinessCalendar,
  opts: { pauseOnPending: boolean; warnPercent: number },
): SlaDues {
  if (CLOSED_STATES.includes(t.state)) return NONE;
  if (opts.pauseOnPending && (PendingStates as readonly string[]).includes(t.state)) return NONE;

  const dues: Array<{ due: Date; warn: Date }> = [];
  const make = (start: Date, minutes: number) => {
    const due = cal.addBusinessMinutes(start, minutes);
    const warn = cal.addBusinessMinutes(start, Math.floor((minutes * opts.warnPercent) / 100));
    dues.push({ due, warn });
    return due;
  };

  const firstResponseDueAt =
    targets.firstResponseMinutes != null && !t.firstResponseAt ? make(t.createdAt, targets.firstResponseMinutes) : null;

  const customerWaiting =
    t.lastCustomerContactAt !== null &&
    (t.lastAgentContactAt === null || t.lastCustomerContactAt > t.lastAgentContactAt);
  const updateDueAt =
    targets.updateMinutes != null && t.firstResponseAt && customerWaiting && t.lastCustomerContactAt
      ? make(t.lastCustomerContactAt, targets.updateMinutes)
      : null;

  const solutionDueAt =
    targets.solutionMinutes != null ? make(t.createdAt, targets.solutionMinutes + t.slaPausedMinutes) : null;

  const min = (xs: Date[]) => (xs.length ? new Date(Math.min(...xs.map((d) => d.getTime()))) : null);
  return {
    firstResponseDueAt,
    updateDueAt,
    solutionDueAt,
    escalationAt: min(dues.map((d) => d.due)),
    slaWarningAt: min(dues.map((d) => d.warn)),
  };
}
