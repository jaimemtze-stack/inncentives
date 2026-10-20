import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';

interface Row {
  organization: string;
  minutes: number;
  billableMinutes: number;
  includedMinutes: number | null;
}

/** 90 → "1:30 h", like the durations of a time tracker. */
const duration = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;

function Total({ label, minutes }: { label: string; minutes: number }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-plum-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{duration(minutes)}</p>
    </div>
  );
}

/** Monthly time accounted per organization against its support plan. */
export function TimeSummaryPage() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const rows = useQuery({
    queryKey: ['time-summary', month],
    queryFn: () => api<Row[]>('GET', `/time-summary?month=${month}`),
  });
  const data = rows.data ?? [];
  const total = data.reduce((n, r) => n + r.minutes, 0);
  const billable = data.reduce((n, r) => n + r.billableMinutes, 0);
  return (
    <div className="space-y-5">
      <div className="page-header mb-0">
        <h1 className="page-title">{t('tickets.timeSummary')}</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="month" className="label">
            {t('tickets.month')}
          </label>
          <input
            id="month"
            type="month"
            className="input mt-0 w-44"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Total label={t('tickets.minutes')} minutes={total} />
        <Total label={t('tickets.billable')} minutes={billable} />
      </div>
      <section className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th className="pl-4">{t('tickets.organization')}</th>
              <th className="text-right">{t('tickets.minutes')}</th>
              <th className="text-right">{t('tickets.billable')}</th>
              <th className="w-1/3">{t('tickets.included')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => {
              const over = r.includedMinutes !== null && r.billableMinutes > r.includedMinutes;
              const pct =
                r.includedMinutes && r.includedMinutes > 0
                  ? Math.min(100, Math.round((r.billableMinutes / r.includedMinutes) * 100))
                  : null;
              return (
                <tr key={r.organization}>
                  <td className="pl-4 font-medium">{r.organization}</td>
                  <td className="text-right tabular-nums">{duration(r.minutes)}</td>
                  <td className="text-right tabular-nums">{duration(r.billableMinutes)}</td>
                  <td>
                    {r.includedMinutes === null ? (
                      <span className="text-plum-500">—</span>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div
                          className="h-2 flex-1 overflow-hidden rounded-full bg-plum-100 dark:bg-plum-700"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={pct ?? 0}
                          aria-label={r.organization}
                        >
                          <div
                            className={`h-full rounded-full ${over ? 'bg-red-600' : 'bg-brand-600 dark:bg-brand-400'}`}
                            style={{ width: `${pct ?? 0}%` }}
                          />
                        </div>
                        <span
                          className={`whitespace-nowrap text-xs tabular-nums ${over ? 'font-semibold text-red-700 dark:text-red-400' : 'text-plum-500'}`}
                        >
                          {over && '⚠ '}
                          {duration(r.includedMinutes)}
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
