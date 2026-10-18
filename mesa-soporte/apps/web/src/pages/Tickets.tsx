import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { formatDate, slaState, type TicketRow } from '../lib/tickets';
import { useMe } from '../session';

interface OverviewMeta {
  slug: string;
  name: string;
  count: number;
}

export function StateBadge({ state }: { state: string }) {
  const { t } = useTranslation();
  const color =
    state === 'new'
      ? 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200'
      : state === 'open'
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
        : state.startsWith('pending')
          ? 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
          : 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>
      {t(`states.${state}`)}
    </span>
  );
}

export function SlaBadge({ ticket }: { ticket: Pick<TicketRow, 'escalationAt' | 'slaWarningAt'> }) {
  const { t } = useTranslation();
  const s = slaState(ticket);
  if (!s) return null;
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-semibold ${
        s === 'breached' ? 'bg-red-700 text-white' : 'bg-amber-500 text-black'
      }`}
    >
      {t(s === 'breached' ? 'tickets.slaBreached' : 'tickets.slaWarning')}
    </span>
  );
}

function TicketTable({ items, staff }: { items: TicketRow[]; staff: boolean }) {
  const { t, i18n } = useTranslation();
  if (!items.length) return <p className="py-6 text-sm text-slate-500">{t('tickets.empty')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table" data-testid="ticket-table">
        <thead>
          <tr>
            <th>{t('tickets.number')}</th>
            <th>{t('tickets.title')}</th>
            <th>{t('tickets.state')}</th>
            {staff && <th>{t('tickets.customer')}</th>}
            {staff && <th>{t('tickets.owner')}</th>}
            <th>{t('tickets.priority')}</th>
            <th>{t('tickets.updated')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((tk) => (
            <tr key={tk.id}>
              <td className="whitespace-nowrap font-mono text-xs">{tk.number}</td>
              <td>
                <Link to="/tickets/$id" params={{ id: tk.id }} className="link">
                  {tk.title}
                </Link>{' '}
                {staff && <SlaBadge ticket={tk} />}
                {staff && tk.sensitiveData && (
                  <span title={t('tickets.sensitive')} aria-label={t('tickets.sensitive')}>
                    {' '}
                    ⚠
                  </span>
                )}
              </td>
              <td>
                <StateBadge state={tk.state} />
              </td>
              {staff && <td>{tk.customer?.name ?? tk.unverifiedFrom ?? '—'}</td>}
              {staff && <td>{tk.owner?.name ?? t('tickets.unassigned')}</td>}
              <td>{tk.priority.name}</td>
              <td className="whitespace-nowrap">{formatDate(tk.updatedAt, i18n.language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ticket overviews (agents and customers) with full-text search. */
export function TicketsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const staff = me.data?.area === 'agent';
  const overviews = useQuery({
    queryKey: ['overviews'],
    queryFn: () => api<OverviewMeta[]>('GET', '/overviews'),
  });
  const [slug, setSlug] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState<string | null>(null);
  const active = slug ?? overviews.data?.[0]?.slug ?? null;

  const list = useInfiniteQuery({
    queryKey: ['tickets', active],
    enabled: !!active && search === null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<{ items: TicketRow[]; nextCursor?: string }>(
        'GET',
        `/tickets?overview=${active}&limit=50${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  const found = useQuery({
    queryKey: ['search', search],
    enabled: search !== null,
    queryFn: () =>
      api<{ items: TicketRow[] }>('GET', `/search?q=${encodeURIComponent(search ?? '')}&limit=50`),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSearch(q.trim() ? q.trim() : null);
  }

  const items =
    search !== null ? (found.data?.items ?? []) : (list.data?.pages.flatMap((p) => p.items) ?? []);

  return (
    <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
      <aside className="space-y-1" aria-label={t('nav.tickets')}>
        <Link to="/tickets/nuevo" className="btn-primary mb-3 w-full">
          {t('nav.newTicket')}
        </Link>
        {overviews.data?.map((o) => (
          <button
            key={o.slug}
            type="button"
            onClick={() => {
              setSlug(o.slug);
              setSearch(null);
            }}
            className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
              o.slug === active && search === null
                ? 'bg-blue-50 font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-100'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>{o.name}</span>
            <span className="rounded bg-slate-200 px-2 text-xs dark:bg-slate-700">{o.count}</span>
          </button>
        ))}
      </aside>
      <section className="card space-y-4">
        <form onSubmit={submit} role="search" className="flex gap-2">
          <label htmlFor="q" className="sr-only">
            {t('tickets.search')}
          </label>
          <input
            id="q"
            className="input mt-0"
            placeholder={t('tickets.searchHint')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={300}
          />
          <button type="submit" className="btn-secondary">
            {t('tickets.search')}
          </button>
        </form>
        <TicketTable items={items} staff={staff} />
        {search === null && list.hasNextPage && (
          <button type="button" className="btn-secondary" onClick={() => void list.fetchNextPage()}>
            {t('tickets.more')}
          </button>
        )}
      </section>
    </div>
  );
}
