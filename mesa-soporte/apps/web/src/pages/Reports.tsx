import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useFormMeta } from '../lib/tickets';

interface Summary {
  totals: { created: number; closed: number; open: number; reopened: number };
  perDay: Array<{ date: string; created: number; closed: number }>;
  firstResponseMinutes: { count: number; median: number | null; p90: number | null };
  solutionMinutes: { count: number; median: number | null; p90: number | null };
  sla: { tickets: number; breached: number; compliancePercent: number | null };
  loadByAgent: Array<{ name: string; open: number }>;
  loadByGroup: Array<{ name: string; open: number }>;
  timeByOrganization: Array<{
    organization: string;
    minutes: number;
    billableMinutes: number;
    includedMinutes: number | null;
  }>;
  topModules: Array<{ key: string; count: number }>;
  topCategories: Array<{ key: string; count: number }>;
}

const dateInput = (d: Date) => d.toISOString().slice(0, 10);
const hours = (m: number | null) =>
  m === null ? '—' : m >= 120 ? `${(m / 60).toFixed(1)} h` : `${m} min`;

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-ink-900 dark:text-white">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

/** Created vs closed per day: two thin lines, legend + direct labels, crosshair tooltip. */
function DailyChart({ data }: { data: Summary['perDay'] }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const pad = { l: 36, r: 64, t: 12, b: 28 };
  const max = Math.max(1, ...data.map((d) => Math.max(d.created, d.closed)));
  const x = (i: number) =>
    pad.l + (data.length <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (data.length - 1));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const path = (k: 'created' | 'closed') =>
    data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join('');
  const ticks = [0, Math.ceil(max / 2), max];
  if (!data.length) return <p className="text-sm text-ink-500">{t('reports.noData')}</p>;
  const last = data.length - 1;
  return (
    <div className="viz-root">
      <div className="mb-2 flex gap-4 text-xs text-ink-700 dark:text-ink-300" aria-hidden="true">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4" style={{ background: 'var(--viz-series-1)' }} />
          {t('reports.created')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4" style={{ background: 'var(--viz-series-2)' }} />
          {t('reports.closed')}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={t('reports.dailyAria')}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * last);
          setHover(i >= 0 && i <= last ? i : null);
        }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--viz-grid)"
              strokeWidth={1}
            />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--viz-axis)">
              {v}
            </text>
          </g>
        ))}
        <text x={pad.l} y={H - 8} fontSize={11} fill="var(--viz-axis)">
          {data[0]!.date}
        </text>
        <text x={W - pad.r} y={H - 8} fontSize={11} textAnchor="end" fill="var(--viz-axis)">
          {data[last]!.date}
        </text>
        <path
          d={path('created')}
          fill="none"
          stroke="var(--viz-series-1)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <path
          d={path('closed')}
          fill="none"
          stroke="var(--viz-series-2)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <text x={x(last) + 6} y={y(data[last]!.created) + 4} fontSize={11} fill="var(--viz-axis)">
          {t('reports.created')}
        </text>
        <text x={x(last) + 6} y={y(data[last]!.closed) + 14} fontSize={11} fill="var(--viz-axis)">
          {t('reports.closed')}
        </text>
        {hover !== null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.t}
              y2={H - pad.b}
              stroke="var(--viz-axis)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={x(hover)}
              cy={y(data[hover]!.created)}
              r={4}
              fill="var(--viz-series-1)"
              stroke="var(--viz-surface)"
              strokeWidth={2}
            />
            <circle
              cx={x(hover)}
              cy={y(data[hover]!.closed)}
              r={4}
              fill="var(--viz-series-2)"
              stroke="var(--viz-surface)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      <p className="h-5 text-xs text-ink-700 dark:text-ink-300" aria-live="polite">
        {hover !== null &&
          `${data[hover]!.date} · ${t('reports.created')}: ${data[hover]!.created} · ${t('reports.closed')}: ${data[hover]!.closed}`}
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer">{t('reports.tableView')}</summary>
        <table className="table">
          <thead>
            <tr>
              <th>{t('reports.date')}</th>
              <th>{t('reports.created')}</th>
              <th>{t('reports.closed')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{d.created}</td>
                <td>{d.closed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function SimpleTable({ title, rows }: { title: string; rows: Array<[string, string | number]> }) {
  return (
    <div className="card">
      <h3 className="mb-2 font-semibold">{title}</h3>
      <table className="table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className="text-right tabular-nums">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportsPage() {
  const { t } = useTranslation();
  const meta = useFormMeta();
  const [from, setFrom] = useState(dateInput(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(dateInput(new Date(Date.now() + 86_400_000)));
  const [groupId, setGroupId] = useState('');
  const orgs = useQuery({
    queryKey: ['orgs'],
    queryFn: () =>
      api<{ items: Array<{ id: string; name: string }> }>('GET', '/admin/organizations?limit=100'),
  });
  const [organizationId, setOrganizationId] = useState('');
  const qs = useMemo(() => {
    const p = new URLSearchParams({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
    if (groupId) p.set('groupId', groupId);
    if (organizationId) p.set('organizationId', organizationId);
    return p.toString();
  }, [from, to, groupId, organizationId]);
  const summary = useQuery({
    queryKey: ['reports', qs],
    queryFn: () => api<Summary>('GET', `/reports/summary?${qs}`),
  });
  const s = summary.data;

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">{t('nav.reports')}</h1>
        <div className="flex gap-2">
          <a className="btn-secondary" href={`/api/v1/reports/export?${qs}&format=csv`}>
            CSV
          </a>
          <a className="btn-secondary" href={`/api/v1/reports/export?${qs}&format=xlsx`}>
            XLSX
          </a>
        </div>
      </div>
      <div
        className="card flex flex-wrap items-end gap-3 py-4"
        role="group"
        aria-label={t('reports.filters')}
      >
        <div>
          <label htmlFor="rf" className="label">
            {t('reports.from')}
          </label>
          <input
            id="rf"
            type="date"
            className="input"
            value={from}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="rt" className="label">
            {t('reports.to')}
          </label>
          <input
            id="rt"
            type="date"
            className="input"
            value={to}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="rg" className="label">
            {t('tickets.group')}
          </label>
          <select
            id="rg"
            className="input"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
          >
            <option value="">{t('kb.all')}</option>
            {meta.data?.groups?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ro" className="label">
            {t('tickets.organization')}
          </label>
          <select
            id="ro"
            className="input"
            value={organizationId}
            onChange={(e) => setOrganizationId(e.target.value)}
          >
            <option value="">{t('kb.all')}</option>
            {orgs.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {s && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label={t('reports.created')} value={s.totals.created} />
            <Tile
              label={t('reports.closed')}
              value={s.totals.closed}
              hint={t('reports.reopened', { n: s.totals.reopened })}
            />
            <Tile
              label={t('reports.firstResponse')}
              value={hours(s.firstResponseMinutes.median)}
              hint={`p90 ${hours(s.firstResponseMinutes.p90)}`}
            />
            <Tile
              label={t('reports.slaCompliance')}
              value={s.sla.compliancePercent === null ? '—' : `${s.sla.compliancePercent} %`}
              hint={t('reports.breached', { n: s.sla.breached, total: s.sla.tickets })}
            />
          </div>
          <section className="card">
            <h2 className="mb-2 font-semibold">{t('reports.daily')}</h2>
            <DailyChart data={s.perDay} />
          </section>
          <section className="grid gap-4 md:grid-cols-2">
            <SimpleTable
              title={t('reports.loadAgent')}
              rows={s.loadByAgent.map((r) => [r.name, r.open])}
            />
            <SimpleTable
              title={t('reports.loadGroup')}
              rows={s.loadByGroup.map((r) => [r.name, r.open])}
            />
            <SimpleTable
              title={t('reports.topModules')}
              rows={s.topModules.map((r) => [r.key, r.count])}
            />
            <SimpleTable
              title={t('reports.topCategories')}
              rows={s.topCategories.map((r) => [r.key, r.count])}
            />
            <SimpleTable
              title={t('reports.solution')}
              rows={[
                [t('reports.median'), hours(s.solutionMinutes.median)],
                ['p90', hours(s.solutionMinutes.p90)],
              ]}
            />
            <SimpleTable
              title={t('tickets.timeSummary')}
              rows={s.timeByOrganization.map((r) => [
                r.organization,
                `${r.billableMinutes} / ${r.includedMinutes ?? '—'} min${r.includedMinutes !== null && r.billableMinutes > r.includedMinutes ? ' ⚠' : ''}`,
              ])}
            />
          </section>
        </>
      )}
    </div>
  );
}
