import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormMeta } from '../lib/tickets';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Icon } from '../components/Icon';
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
      ? 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100'
      : state === 'open'
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
        : state.startsWith('pending')
          ? 'bg-plum-200 text-plum-800 dark:bg-plum-800 dark:text-plum-200'
          : 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200';
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
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

const DAY_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "Hoy", "Ayer" or the long date, like the day headers of a time-entry list. */
function dayLabel(key: string, lng: string, t: (k: string) => string): string {
  const today = DAY_KEY.format(new Date());
  const yesterday = DAY_KEY.format(new Date(Date.now() - 86_400_000));
  if (key === today) return t('tickets.today');
  if (key === yesterday) return t('tickets.yesterday');
  return new Intl.DateTimeFormat(lng.startsWith('en') ? 'en-US' : 'es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${key}T12:00:00Z`));
}

const TIME = (lng: string) =>
  new Intl.DateTimeFormat(lng.startsWith('en') ? 'en-US' : 'es-MX', {
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  });

/** Tickets grouped by the day of their last update, newest first. */
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
  if (!items.length)
    return <p className="px-6 py-10 text-center text-sm text-plum-500">{t('tickets.empty')}</p>;
  const days: Array<[string, TicketRow[]]> = [];
  for (const tk of items) {
    const key = DAY_KEY.format(new Date(tk.updatedAt));
    const last = days[days.length - 1];
    if (last && last[0] === key) last[1].push(tk);
    else days.push([key, [tk]]);
  }
  const time = TIME(i18n.language);
  const cols = staff ? 7 : 4;
  return (
    <div className="overflow-x-auto">
      <table className="table" data-testid="ticket-table">
        <thead>
          <tr>
            {staff && (
              <th className="pl-4">
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
            <th className={staff ? '' : 'pl-4'}>{t('tickets.title')}</th>
            <th>{t('tickets.state')}</th>
            {staff && <th>{t('tickets.customer')}</th>}
            {staff && <th>{t('tickets.owner')}</th>}
            <th>{t('tickets.priority')}</th>
            <th className="text-right">{t('tickets.updated')}</th>
          </tr>
        </thead>
        {days.map(([key, rows]) => (
          <tbody key={key}>
            <tr className="bg-plum-50 dark:bg-plum-900/60">
              <th
                colSpan={cols}
                scope="colgroup"
                className="py-2 pl-4 !text-sm !normal-case !tracking-normal text-plum-700 dark:text-plum-200"
              >
                <span className="inline-block first-letter:uppercase">
                  {dayLabel(key, i18n.language, t)}
                </span>
                <span className="float-right pr-4 text-xs font-medium text-plum-500">
                  {t('tickets.ticketCount', { count: rows.length })}
                </span>
              </th>
            </tr>
            {rows.map((tk) => (
              <tr key={tk.id}>
                {staff && (
                  <td className="pl-4">
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
                <td className={staff ? '' : 'pl-4'}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      to="/tickets/$id"
                      params={{ id: tk.id }}
                      className="font-medium text-plum-900 hover:text-brand-700 hover:underline dark:text-slate-100 dark:hover:text-brand-300"
                    >
                      {tk.title}
                    </Link>
                    {staff && <SlaBadge ticket={tk} />}
                    {staff && tk.sensitiveData && (
                      <span title={t('tickets.sensitive')} aria-label={t('tickets.sensitive')}>
                        ⚠
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-plum-500">
                    <span className="font-mono">#{tk.number}</span>
                    {tk.group && (
                      <>
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: groupColor(tk.group.name) }}
                          aria-hidden="true"
                        />
                        <span>{tk.group.name}</span>
                      </>
                    )}
                  </div>
                </td>
                <td>
                  <StateBadge state={tk.state} />
                </td>
                {staff && <td>{tk.customer?.name ?? tk.unverifiedFrom ?? '—'}</td>}
                {staff && (
                  <td className={tk.owner ? '' : 'text-plum-500'}>
                    {tk.owner?.name ?? t('tickets.unassigned')}
                  </td>
                )}
                <td>{tk.priority.name}</td>
                <td
                  className="whitespace-nowrap text-right tabular-nums text-plum-600 dark:text-plum-300"
                  title={formatDate(tk.updatedAt, i18n.language)}
                >
                  {time.format(new Date(tk.updatedAt))}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** Stable colour per group (the coloured project dot of a time-entry list). */
const GROUP_COLORS = ['#7e3fbf', '#d6409f', '#2a78d6', '#1f9d74', '#d97706', '#0e7490', '#b4495b'];
function groupColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length]!;
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
      className="flex flex-wrap items-end gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm dark:border-brand-800 dark:bg-brand-950"
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

interface GlobalResults {
  tickets: TicketRow[];
  kb: Array<{ id: string; title: string; snippet: string }>;
  users: Array<{ id: string; name: string; email: string; organization: { name: string } | null }>;
  organizations: Array<{ id: string; name: string; domains: string[] }>;
}

/** Knowledge base, people and organizations found by the global search. */
function OtherResults({ data }: { data: GlobalResults }) {
  const { t } = useTranslation();
  const sections = [
    {
      key: 'kb',
      rows: data.kb.map((a) => (
        <li key={a.id}>
          <Link to="/kb/$id" params={{ id: a.id }} className="underline">
            {a.title}
          </Link>
        </li>
      )),
    },
    {
      key: 'users',
      rows: data.users.map((u) => (
        <li key={u.id}>
          {u.name} · {u.email}
          {u.organization ? ` · ${u.organization.name}` : ''}
        </li>
      )),
    },
    {
      key: 'organizations',
      rows: data.organizations.map((o) => (
        <li key={o.id}>
          {o.name}
          {o.domains.length ? ` · ${o.domains.join(', ')}` : ''}
        </li>
      )),
    },
  ].filter((x) => x.rows.length);
  if (!sections.length) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {sections.map((x) => (
        <section key={x.key} aria-labelledby={`gs-${x.key}`}>
          <h2 id={`gs-${x.key}`} className="mb-1 text-sm font-semibold">
            {t(`globalSearch.${x.key}`)}
          </h2>
          <ul className="space-y-1 text-sm">{x.rows}</ul>
        </section>
      ))}
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
      api<GlobalResults>('GET', `/search/global?q=${encodeURIComponent(search ?? '')}`),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSearch(q.trim() ? q.trim() : null);
  }

  const items =
    search !== null
      ? (found.data?.tickets ?? [])
      : (list.data?.pages.flatMap((p) => p.items) ?? []);

  return (
    <div className="space-y-5">
      <h1 className="page-title">
        {t(staff ? 'agent.welcome' : 'portal.welcome', { name: me.data?.user.name ?? '' })}
      </h1>
      {/* Search bar on top of the list, like the timer bar of a time tracker. */}
      <div className="card flex items-center gap-3 px-4 py-3">
        <form onSubmit={submit} role="search" className="flex min-w-0 flex-1 items-center gap-3">
          <label htmlFor="q" className="sr-only">
            {t('tickets.search')}
          </label>
          <Icon name="search" className="h-5 w-5 shrink-0 text-plum-500" />
          <input
            id="q"
            className="min-w-0 flex-1 border-0 bg-transparent py-2 text-base placeholder:text-plum-500 focus:outline-none focus:ring-0"
            placeholder={t('tickets.searchHint')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={300}
          />
          <button type="submit" className="btn-secondary">
            <span className="sr-only sm:not-sr-only">{t('tickets.search')}</span>
            <Icon name="search" className="h-4 w-4 sm:hidden" />
          </button>
        </form>
        <Link to="/tickets/nuevo" className="btn-accent" title={t('nav.newTicket')}>
          <Icon name="plus" className="h-6 w-6" />
          <span className="sr-only">{t('nav.newTicket')}</span>
        </Link>
      </div>
      <div className="segmented" role="group" aria-label={t('nav.tickets')}>
        {overviews.data?.map((o) => (
          <button
            key={o.slug}
            type="button"
            aria-pressed={o.slug === active && search === null}
            onClick={() => {
              setSlug(o.slug);
              setSearch(null);
            }}
            className={`segment ${o.slug === active && search === null ? 'segment-active' : ''}`}
          >
            <span>{o.name}</span>
            <span className="count">{o.count}</span>
          </button>
        ))}
      </div>
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
      {search !== null && found.data && (
        <div className="card">
          <OtherResults data={found.data} />
        </div>
      )}
      <section className="card overflow-hidden p-0">
        <TicketTable items={items} staff={staff} selected={selected} onSelect={setSelected} />
      </section>
      {search === null && list.hasNextPage && (
        <button type="button" className="btn-secondary" onClick={() => void list.fetchNextPage()}>
          {t('tickets.more')}
        </button>
      )}
    </div>
  );
}
