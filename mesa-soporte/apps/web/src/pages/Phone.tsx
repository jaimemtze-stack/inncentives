import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { formatDate, type Ref } from '../lib/tickets';

interface Lookup {
  normalized: string | null;
  customers: Array<Ref & { email: string; phone: string | null; organization: Ref }>;
  tickets: Array<{ id: string; number: string; title: string; state: string; customerId: string }>;
}

interface Call {
  id: string;
  callId: string;
  direction: string;
  fromNumber: string;
  toNumber: string;
  state: string;
  startedAt: string;
}

export function PhonePage() {
  const { t, i18n } = useTranslation();
  const initial = new URLSearchParams(window.location.search).get('number') ?? '';
  const [number, setNumber] = useState(initial);
  const [query, setQuery] = useState(initial);
  const lookup = useQuery({
    queryKey: ['phone', query],
    enabled: query.length >= 3,
    queryFn: () => api<Lookup>('GET', `/phone/lookup?number=${encodeURIComponent(query)}`),
  });
  const calls = useQuery({
    queryKey: ['calls'],
    queryFn: () => api<Call[]>('GET', '/phone/calls'),
    refetchInterval: 30_000,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setQuery(number.trim());
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="card space-y-3">
        <h1 className="text-xl font-semibold">{t('phone.title')}</h1>
        <form onSubmit={submit} className="flex gap-2">
          <label htmlFor="num" className="sr-only">
            {t('phone.lookup')}
          </label>
          <input
            id="num"
            className="input mt-0"
            inputMode="tel"
            placeholder={t('phone.lookup')}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            maxLength={30}
          />
          <button type="submit" className="btn-secondary">
            {t('tickets.search')}
          </button>
        </form>
        {lookup.data && (
          <div className="space-y-3 text-sm">
            {lookup.data.normalized && (
              <p className="font-mono text-xs">{lookup.data.normalized}</p>
            )}
            {!lookup.data.customers.length && <p>{t('phone.noMatch')}</p>}
            {lookup.data.customers.map((c) => (
              <div key={c.id} className="rounded border border-ink-200 p-3 dark:border-ink-700">
                <p className="font-semibold">{c.name}</p>
                <p>
                  {c.email} · {c.organization.name}
                </p>
                <ul className="mt-2 list-disc pl-5">
                  {lookup
                    .data!.tickets.filter((tk) => tk.customerId === c.id)
                    .map((tk) => (
                      <li key={tk.id}>
                        <Link to="/tickets/$id" params={{ id: tk.id }} className="link">
                          #{tk.number} {tk.title}
                        </Link>
                      </li>
                    ))}
                </ul>
                <Link to="/tickets/nuevo" className="btn-primary mt-2">
                  {t('phone.logCall')}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="card">
        <h2 className="mb-2 font-semibold">{t('phone.calls')}</h2>
        <table className="table">
          <tbody>
            {calls.data?.map((c) => (
              <tr key={c.id}>
                <td>{t(`article.${c.direction}`)}</td>
                <td className="font-mono text-xs">
                  {c.direction === 'in' ? c.fromNumber : c.toNumber}
                </td>
                <td>{c.state}</td>
                <td className="whitespace-nowrap">{formatDate(c.startedAt, i18n.language)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
