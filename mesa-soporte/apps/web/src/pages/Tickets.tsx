import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormMeta } from '../lib/tickets';
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

function TicketTable({
  items,
  staff,
  selected,
  onSelect,
}: {
  items: TicketRow[];
  staff: boolean;
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
}) {
  const { t, i18n } = useTranslation();
  if (!items.length) return <p className="py-6 text-sm text-slate-500">{t('tickets.empty')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table" data-testid="ticket-table">
        <thead>
          <tr>
            {staff && (
              <th>
                <input
                  type="checkbox"
                  aria-label={t('tickets.selectAll')}
                  checked={items.length > 0 && items.every((x) => selected.has(x.id))}
                  onChange={(e) =>
                    onSelect(e.target.checked ? new Set(items.map((x) => x.id)) : new Set())
                  }
                />
              </th>
            )}
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
              {staff && (
                <td>
                  <input
                    type="checkbox"
                    aria-label={tk.number}
                    checked={selected.has(tk.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(tk.id);
                      else next.delete(tk.id);
                      onSelect(next);
                    }}
                  />
                </td>
              )}
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

/** Bulk changes; the API authorises every ticket on its own and reports per ticket. */
function BulkBar({ ids, onDone }: { ids: string[]; onDone: (message: string) => void }) {
  const { t } = useTranslation();
  const meta = useFormMeta();
  const [state, setState] = useState('');
  const [tag, setTag] = useState('');
  const [macroId, setMacroId] = useState('');
  async function apply() {
    const r = await api<{ results: Array<{ ok: boolean }> }>('POST', '/tickets/bulk', {
      ids,
      ...(state ? { changes: { state } } : {}),
      ...(tag.trim() ? { addTags: [tag.trim()] } : {}),
      ...(macroId ? { macroId } : {}),
    });
    const ok = r.results.filter((x) => x.ok).length;
    onDone(t('tickets.bulkResult', { ok, total: r.results.length }));
  }
  return (
    <div
      className="flex flex-wrap items-end gap-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950"
      role="region"
      aria-label={t('tickets.bulk')}
    >
      <span className="font-semibold">{t('tickets.selected', { n: ids.length })}</span>
      <select
        aria-label={t('tickets.state')}
        className="input mt-0 w-44"
        value={state}
        onChange={(e) => setState(e.target.value)}
      >
        <option value="">{t('tickets.state')}…</option>
        {['open', 'resolved', 'closed'].map((s) => (
          <option key={s} value={s}>
            {t(`states.${s}`)}
          </option>
        ))}
      </select>
      <input
        aria-label={t('tickets.addTag')}
        placeholder={t('tickets.addTag')}
        className="input mt-0 w-40"
        value={tag}
        onChange={(e) => setTag(e.target.value)}
      />
      <select
        aria-label={t('tickets.macros')}
        className="input mt-0 w-44"
        value={macroId}
        onChange={(e) => setMacroId(e.target.value)}
      >
        <option value="">{t('tickets.macros')}…</option>
        {meta.data?.macros?.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn-primary"
        disabled={!state && !tag.trim() && !macroId}
        onClick={() => void apply()}
      >
        {t('tickets.apply')}
      </button>
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const qc = useQueryClient();

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
        <h1 className="text-xl font-semibold">
          {t(staff ? 'agent.welcome' : 'portal.welcome', { name: me.data?.user.name ?? '' })}
        </h1>
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
        {staff && selected.size > 0 && (
          <BulkBar
            ids={[...selected]}
            onDone={(message) => {
              setBulkMsg(message);
              setSelected(new Set());
              void qc.invalidateQueries({ queryKey: ['tickets'] });
              void qc.invalidateQueries({ queryKey: ['overviews'] });
            }}
          />
        )}
        {bulkMsg && (
          <p role="status" className="text-sm text-green-800 dark:text-green-300">
            {bulkMsg}
          </p>
        )}
        <TicketTable items={items} staff={staff} selected={selected} onSelect={setSelected} />
        {search === null && list.hasNextPage && (
          <button type="button" className="btn-secondary" onClick={() => void list.fetchNextPage()}>
            {t('tickets.more')}
          </button>
        )}
      </section>
    </div>
  );
}
