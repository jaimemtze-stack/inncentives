import { Injectable } from '@nestjs/common';
import { ConditionSchema, PendingStates } from '@mesa/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { evaluate } from '../rules/conditions';
import { ticketSnapshot, type TicketWithTags } from '../rules/snapshot';
import {
  BusinessCalendar,
  DEFAULT_MEXICO_CALENDAR,
  type CalendarDefinition,
} from '../sla/calendar';
import { computeSlaDues } from '../sla/sla';

const isPending = (s: string) => (PendingStates as readonly string[]).includes(s);

/**
 * Applies SLAs to tickets: picks the first active SLA (by position) whose
 * conditions match, then stores the due dates computed in business time.
 */
@Injectable()
export class SlaService {
  private calendars = new Map<string, { cal: BusinessCalendar; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async calendar(
    id: string | null,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<BusinessCalendar> {
    const key = id ?? 'default';
    const hit = this.calendars.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.cal;
    const row = id
      ? await db.businessCalendar.findUnique({ where: { id } })
      : await db.businessCalendar.findFirst({ where: { isDefault: true } });
    const def: CalendarDefinition = row
      ? {
          timezone: row.timezone,
          hours: row.hours as CalendarDefinition['hours'],
          holidays: row.holidays,
          mexicoStatutory: row.mexicoStatutory,
        }
      : DEFAULT_MEXICO_CALENDAR;
    const cal = new BusinessCalendar(def);
    this.calendars.set(key, { cal, at: Date.now() });
    return cal;
  }

  invalidate(): void {
    this.calendars.clear();
  }

  /**
   * Pause bookkeeping for a state change: entering a pending state starts the
   * pause, leaving it adds the paused business minutes to the ticket.
   */
  async pausePatch(
    t: {
      state: string;
      slaId: string | null;
      slaPausedSince: Date | null;
      slaPausedMinutes: number;
    },
    newState: string,
    now: Date,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Prisma.TicketUncheckedUpdateInput> {
    if (!isPending(t.state) && isPending(newState)) return { slaPausedSince: now };
    if (isPending(t.state) && !isPending(newState) && t.slaPausedSince) {
      const sla = t.slaId ? await db.sla.findUnique({ where: { id: t.slaId } }) : null;
      const cal = await this.calendar(sla?.calendarId ?? null, db);
      return {
        slaPausedSince: null,
        slaPausedMinutes: t.slaPausedMinutes + cal.businessMinutesBetween(t.slaPausedSince, now),
      };
    }
    return {};
  }

  /** Re-selects the SLA and recomputes the due dates of one ticket. */
  async recompute(ticketId: string, db: Prisma.TransactionClient = this.prisma): Promise<void> {
    const t = (await db.ticket.findUnique({
      where: { id: ticketId },
      include: {
        tags: true,
        customer: { select: { email: true } },
        organization: { select: { supportPlanId: true } },
      },
    })) as
      | (TicketWithTags & {
          customer: { email: string } | null;
          organization: { supportPlanId: string | null } | null;
        })
      | null;
    if (!t) return;
    const slas = await db.sla.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { targets: true },
    });
    const ctx = { ticket: ticketSnapshot(t), customer: t.customer, organization: t.organization };
    const sla = slas.find((s) => {
      const parsed = ConditionSchema.safeParse(s.conditions);
      return parsed.success && evaluate(parsed.data, ctx);
    });
    const target = sla?.targets.find((x) => x.priorityId === t.priorityId);
    let dues = {
      firstResponseDueAt: null,
      updateDueAt: null,
      solutionDueAt: null,
      escalationAt: null,
      slaWarningAt: null,
    } as ReturnType<typeof computeSlaDues>;
    if (sla && target) {
      const cal = await this.calendar(sla.calendarId, db);
      dues = computeSlaDues(t, target, cal, {
        pauseOnPending: sla.pauseOnPending,
        warnPercent: sla.warnPercent,
      });
    }
    const changed =
      t.slaId !== (sla?.id ?? null) ||
      (Object.keys(dues) as Array<keyof typeof dues>).some(
        (k) => t[k]?.getTime() !== dues[k]?.getTime(),
      );
    if (changed)
      await db.ticket.update({ where: { id: t.id }, data: { slaId: sla?.id ?? null, ...dues } });
  }
}
