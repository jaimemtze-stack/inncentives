import { Injectable } from '@nestjs/common';
import { OpenStates } from '@mesa/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { TicketAccessService } from '../tickets/access.service';
import { toCsv, toXlsx, type Cell } from './export';

export interface ReportFilter {
  from: Date;
  to: Date;
  organizationId?: string;
  groupId?: string;
  ownerId?: string;
}

const MAX_ROWS = 50_000;
const MAX_DAYS = 400;

function minutesBetween(a: Date, b: Date | null): number | null {
  return b ? Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000)) : null;
}

function stats(values: number[]) {
  if (!values.length) return { count: 0, avg: null, median: null, p90: null };
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return {
    count: s.length,
    avg: Math.round(s.reduce((x, y) => x + y, 0) / s.length),
    median: q(0.5),
    p90: q(0.9),
  };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Reports over the tickets the user may read (the same policy as views and
 * search). Times are wall-clock minutes; SLA compliance comes from the
 * breach events recorded by the jobs service.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
    private readonly audit: AuditService,
  ) {}

  private check(f: ReportFilter) {
    if (!(f.from < f.to)) throw new AppError('validation_failed', 'Invalid period.');
    if (f.to.getTime() - f.from.getTime() > MAX_DAYS * 86_400_000)
      throw new AppError('validation_failed', 'Period too long.');
  }

  private async where(actor: AuthenticatedUser, f: ReportFilter): Promise<Prisma.TicketWhereInput> {
    return {
      AND: [
        await this.access.scope(actor, 'read'),
        { state: { not: 'merged' } },
        f.organizationId ? { organizationId: f.organizationId } : {},
        f.groupId ? { groupId: f.groupId } : {},
        f.ownerId ? { ownerId: f.ownerId } : {},
      ],
    };
  }

  async summary(actor: AuthenticatedUser, f: ReportFilter) {
    this.check(f);
    const base = await this.where(actor, f);
    const inPeriod = { gte: f.from, lt: f.to };
    const [created, closedRows, openNow, breaches, reopens, time] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { AND: [base, { createdAt: inPeriod }] },
        select: {
          id: true,
          createdAt: true,
          firstResponseAt: true,
          slaId: true,
          customFields: true,
          groupId: true,
        },
        take: MAX_ROWS,
      }),
      this.prisma.ticket.findMany({
        where: { AND: [base, { OR: [{ closedAt: inPeriod }, { solvedAt: inPeriod }] }] },
        select: { id: true, createdAt: true, closedAt: true, solvedAt: true },
        take: MAX_ROWS,
      }),
      this.prisma.ticket.findMany({
        where: { AND: [base, { state: { in: [...OpenStates] } }] },
        select: {
          ownerId: true,
          groupId: true,
          owner: { select: { name: true } },
          group: { select: { name: true } },
        },
        take: MAX_ROWS,
      }),
      this.prisma.ticketSlaEvent.findMany({
        where: { kind: 'sla_breach', ticket: { AND: [base, { createdAt: inPeriod }] } },
        select: { ticketId: true },
        distinct: ['ticketId'],
      }),
      this.prisma.ticketHistory.count({
        where: {
          field: 'state',
          oldValue: { in: ['resolved', 'closed'] },
          newValue: { in: ['open', 'new'] },
          createdAt: inPeriod,
          ticket: base,
        },
      }),
      this.prisma.timeEntry.findMany({
        where: { createdAt: inPeriod, ticket: base },
        select: {
          minutes: true,
          billable: true,
          ticket: {
            select: { organization: { select: { id: true, name: true, supportPlan: true } } },
          },
        },
        take: MAX_ROWS,
      }),
    ]);

    const perDay = new Map<string, { created: number; closed: number }>();
    for (const t of created) {
      const cur = perDay.get(day(t.createdAt)) ?? { created: 0, closed: 0 };
      perDay.set(day(t.createdAt), { ...cur, created: cur.created + 1 });
    }
    for (const t of closedRows) {
      const d = day((t.closedAt ?? t.solvedAt)!);
      const cur = perDay.get(d) ?? { created: 0, closed: 0 };
      perDay.set(d, { ...cur, closed: cur.closed + 1 });
    }

    const withSla = created.filter((t) => t.slaId).length;
    const count = <K extends string>(items: Array<K | null | undefined>) => {
      const m = new Map<string, number>();
      for (const k of items) if (k) m.set(k, (m.get(k) ?? 0) + 1);
      return [...m]
        .map(([key, n]) => ({ key, count: n }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    };
    const load = (key: 'owner' | 'group') => {
      const m = new Map<string, { name: string; open: number }>();
      for (const t of openNow) {
        const id = key === 'owner' ? (t.ownerId ?? 'none') : t.groupId;
        const name = key === 'owner' ? (t.owner?.name ?? '—') : t.group.name;
        m.set(id, { name, open: (m.get(id)?.open ?? 0) + 1 });
      }
      return [...m.values()].sort((a, b) => b.open - a.open);
    };
    const timeByOrg = new Map<
      string,
      {
        organization: string;
        minutes: number;
        billableMinutes: number;
        includedMinutes: number | null;
      }
    >();
    for (const e of time) {
      const o = e.ticket.organization;
      const key = o?.id ?? 'none';
      const row = timeByOrg.get(key) ?? {
        organization: o?.name ?? '—',
        minutes: 0,
        billableMinutes: 0,
        includedMinutes: o?.supportPlan?.includedMinutesPerMonth ?? null,
      };
      row.minutes += e.minutes;
      if (e.billable) row.billableMinutes += e.minutes;
      timeByOrg.set(key, row);
    }

    return {
      period: { from: f.from, to: f.to },
      totals: {
        created: created.length,
        closed: closedRows.length,
        open: openNow.length,
        reopened: reopens,
      },
      perDay: [...perDay]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, ...v })),
      firstResponseMinutes: stats(
        created
          .map((t) => minutesBetween(t.createdAt, t.firstResponseAt))
          .filter((x): x is number => x !== null),
      ),
      solutionMinutes: stats(
        closedRows
          .map((t) => minutesBetween(t.createdAt, t.solvedAt ?? t.closedAt))
          .filter((x): x is number => x !== null),
      ),
      sla: {
        tickets: withSla,
        breached: breaches.length,
        compliancePercent: withSla
          ? Math.round(((withSla - breaches.length) / withSla) * 1000) / 10
          : null,
      },
      loadByAgent: load('owner'),
      loadByGroup: load('group'),
      timeByOrganization: [...timeByOrg.values()].sort((a, b) => b.minutes - a.minutes),
      topModules: count(
        created.map((t) => (t.customFields as Record<string, string> | null)?.inncentives_module),
      ),
      topCategories: count(
        created.map((t) => (t.customFields as Record<string, string> | null)?.category),
      ),
    };
  }

  /** Ticket list of the period as CSV or XLSX (formula-safe), audited. */
  async export(req: FastifyRequest, f: ReportFilter, format: 'csv' | 'xlsx') {
    this.check(f);
    const actor = req.auth!.user;
    const rows = await this.prisma.ticket.findMany({
      where: { AND: [await this.where(actor, f), { createdAt: { gte: f.from, lt: f.to } }] },
      include: {
        priority: { select: { name: true } },
        group: { select: { name: true } },
        owner: { select: { name: true } },
        organization: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS,
    });
    const header = [
      'Número',
      'Título',
      'Estado',
      'Prioridad',
      'Grupo',
      'Propietario',
      'Organización',
      'Canal',
      'Creado',
      'Primera respuesta',
      'Resuelto',
      'Cerrado',
      'Minutos contabilizados',
      'Módulo',
      'Categoría',
    ];
    const data: Cell[][] = rows.map((t) => {
      const cf = (t.customFields ?? {}) as Record<string, string>;
      return [
        t.number,
        t.title,
        t.state,
        t.priority.name,
        t.group.name,
        t.owner?.name,
        t.organization?.name,
        t.channel,
        t.createdAt,
        t.firstResponseAt,
        t.solvedAt,
        t.closedAt,
        t.timeSpentMinutes,
        cf.inncentives_module,
        cf.category,
      ];
    });
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'report.exported',
      targetType: 'report',
      data: {
        format,
        rows: rows.length,
        from: f.from,
        to: f.to,
        organizationId: f.organizationId ?? null,
      },
    });
    return format === 'csv'
      ? {
          body: Buffer.from(toCsv(header, data), 'utf8'),
          contentType: 'text/csv; charset=utf-8',
          ext: 'csv',
        }
      : {
          body: toXlsx('Tickets', header, data),
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ext: 'xlsx',
        };
  }
}
