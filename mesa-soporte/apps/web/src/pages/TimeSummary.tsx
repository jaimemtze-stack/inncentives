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

/** Monthly time accounted per organization against its support plan. */
export function TimeSummaryPage() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const rows = useQuery({
    queryKey: ['time-summary', month],
    queryFn: () => api<Row[]>('GET', `/time-summary?month=${month}`),
  });
  return (
    <section className="card space-y-4">
      <h1 className="text-xl font-semibold">{t('tickets.timeSummary')}</h1>
      <div className="w-48">
        <label htmlFor="month" className="label">
          {t('tickets.month')}
        </label>
        <input
          id="month"
          type="month"
          className="input"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>{t('tickets.organization')}</th>
            <th>{t('tickets.minutes')}</th>
            <th>{t('tickets.billable')}</th>
            <th>{t('tickets.included')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.data?.map((r) => (
            <tr key={r.organization}>
              <td>{r.organization}</td>
              <td>{r.minutes}</td>
              <td>{r.billableMinutes}</td>
              <td
                className={
                  r.includedMinutes !== null && r.billableMinutes > r.includedMinutes
                    ? 'font-semibold text-red-700'
                    : ''
                }
              >
                {r.includedMinutes ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
