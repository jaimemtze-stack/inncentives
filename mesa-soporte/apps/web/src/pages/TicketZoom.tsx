import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { InncentivesPanel } from './Report';
import { AiPanel, useAiEnabled } from '../components/AiPanel';
import { htmlText } from '../lib/tickets';
import { ArticleView, type ArticleAction } from '../components/ArticleView';
import { Composer, CustomFieldInputs, type ComposerPreset } from '../components/Composer';
import { Alert, useErrorText } from '../components/ui';
import { usePresence } from '../lib/realtime';
import { formatDate, useFormMeta, type Article, type Ref, type TicketRow } from '../lib/tickets';
import { useMe } from '../session';
import { SlaBadge, StateBadge } from './Tickets';

interface TicketDetail extends TicketRow {
  tags?: string[];
  customFields: Record<string, unknown>;
  timeSpentMinutes?: number;
  subscribed?: boolean;
  canChange?: boolean;
  firstResponseDueAt?: string | null;
  solutionDueAt?: string | null;
}

function CustomerLink({ ticketId, onDone }: { ticketId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const found = useQuery({
    queryKey: ['lookup', q],
    enabled: q.length >= 2,
    queryFn: () =>
      api<Array<Ref & { email: string }>>('GET', `/lookup/customers?q=${encodeURIComponent(q)}`),
  });
  return (
    <div className="space-y-2">
      <label htmlFor="link-customer" className="label">
        {t('tickets.customerSearch')}
      </label>
      <input
        id="link-customer"
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="text-sm">
        {found.data?.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="link"
              onClick={async () => {
                await api('PATCH', `/tickets/${ticketId}`, { customerId: c.id });
                onDone();
              }}
            >
              {c.name} · {c.email}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentSidebar({ ticket, reload }: { ticket: TicketDetail; reload: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const meta = useFormMeta();
  const [form, setForm] = useState({
    state: ticket.state,
    priorityId: ticket.priority.id ?? '',
    groupId: ticket.group?.id ?? '',
    ownerId: ticket.owner?.id ?? '',
    pendingUntil: ticket.pendingUntil ? ticket.pendingUntil.slice(0, 16) : '',
    customFields: ticket.customFields ?? {},
  });
  const [tag, setTag] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  useEffect(() => {
    setForm({
      state: ticket.state,
      priorityId: ticket.priority.id ?? '',
      groupId: ticket.group?.id ?? '',
      ownerId: ticket.owner?.id ?? '',
      pendingUntil: ticket.pendingUntil ? ticket.pendingUntil.slice(0, 16) : '',
      customFields: ticket.customFields ?? {},
    });
  }, [ticket]);
  const checklist = useQuery({
    queryKey: ['ticket', ticket.id, 'checklist'],
    queryFn: () =>
      api<Array<{ id: string; text: string; done: boolean }>>(
        'GET',
        `/tickets/${ticket.id}/checklist`,
      ),
  });
  const [item, setItem] = useState('');

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ kind: 'success', text: ok });
      reload();
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const pending = form.state.startsWith('pending');
    void act(
      () =>
        api('PATCH', `/tickets/${ticket.id}`, {
          state: form.state,
          priorityId: form.priorityId || undefined,
          groupId: form.groupId || undefined,
          ownerId: form.ownerId || null,
          pendingUntil:
            pending && form.pendingUntil ? new Date(form.pendingUntil).toISOString() : undefined,
          customFields: form.customFields,
        }),
      t('tickets.saved'),
    );
  }

  const owners = meta.data?.ownersByGroup?.[form.groupId] ?? [];
  const macros = (meta.data?.macros ?? []).filter(
    (m) => !m.groupIds.length || m.groupIds.includes(ticket.group?.id ?? ''),
  );
  const disabled = !ticket.canChange;

  return (
    <aside className="space-y-4">
      <form onSubmit={save} className="card space-y-3">
        <div>
          <label htmlFor="s-state" className="label">
            {t('tickets.state')}
          </label>
          <select
            id="s-state"
            className="input"
            value={form.state}
            disabled={disabled}
            onChange={(e) => setForm({ ...form, state: e.target.value })}
          >
            {(meta.data?.states ?? []).map((s) => (
              <option key={s} value={s}>
                {t(`states.${s}`)}
              </option>
            ))}
          </select>
        </div>
        {form.state.startsWith('pending') && (
          <div>
            <label htmlFor="s-pending" className="label">
              {t('tickets.pendingUntil')}
            </label>
            <input
              id="s-pending"
              type="datetime-local"
              className="input"
              value={form.pendingUntil}
              onChange={(e) => setForm({ ...form, pendingUntil: e.target.value })}
            />
          </div>
        )}
        <div>
          <label htmlFor="s-prio" className="label">
            {t('tickets.priority')}
          </label>
          <select
            id="s-prio"
            className="input"
            value={form.priorityId}
            disabled={disabled}
            onChange={(e) => setForm({ ...form, priorityId: e.target.value })}
          >
            {meta.data?.priorities?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="s-group" className="label">
            {t('tickets.group')}
          </label>
          <select
            id="s-group"
            className="input"
            value={form.groupId}
            disabled={disabled}
            onChange={(e) => setForm({ ...form, groupId: e.target.value })}
          >
            {ticket.group && !meta.data?.groups?.some((g) => g.id === ticket.group!.id) && (
              <option value={ticket.group.id}>{ticket.group.name}</option>
            )}
            {meta.data?.groups?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="s-owner" className="label">
            {t('tickets.owner')}
          </label>
          <select
            id="s-owner"
            className="input"
            value={form.ownerId}
            disabled={disabled}
            onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
          >
            <option value="">{t('tickets.unassigned')}</option>
            {ticket.owner && !owners.some((o) => o.id === ticket.owner!.id) && (
              <option value={ticket.owner.id}>{ticket.owner.name}</option>
            )}
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        {meta.data && (
          <CustomFieldInputs
            attributes={meta.data.attributes}
            values={form.customFields}
            customer={false}
            disabled={disabled}
            onChange={(v) => setForm({ ...form, customFields: v })}
          />
        )}
        {!disabled && (
          <button type="submit" className="btn-primary w-full">
            {t('tickets.save')}
          </button>
        )}
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      </form>

      <div className="card space-y-3 text-sm">
        <div>
          <h3 className="font-semibold">{t('tickets.tags')}</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {ticket.tags?.map((x) => (
              <button
                key={x}
                type="button"
                className="rounded bg-slate-200 px-2 text-xs dark:bg-slate-700"
                title="×"
                onClick={() =>
                  void act(() => api('POST', `/tickets/${ticket.id}/tags/remove`, { tags: [x] }))
                }
              >
                {x} ×
              </button>
            ))}
          </div>
          <form
            className="mt-2 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (tag.trim())
                void act(() =>
                  api('POST', `/tickets/${ticket.id}/tags`, { tags: [tag.trim()] }),
                ).then(() => setTag(''));
            }}
          >
            <label htmlFor="newtag" className="sr-only">
              {t('tickets.addTag')}
            </label>
            <input
              id="newtag"
              className="input mt-0"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder={t('tickets.addTag')}
            />
          </form>
        </div>
        <div>
          <h3 className="font-semibold">{t('tickets.checklist')}</h3>
          <ul>
            {checklist.data?.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={c.done}
                    onChange={(e) =>
                      void act(() =>
                        api('PATCH', `/tickets/${ticket.id}/checklist/${c.id}`, {
                          done: e.target.checked,
                        }),
                      ).then(() => checklist.refetch())
                    }
                  />
                  {c.text}
                </label>
              </li>
            ))}
          </ul>
          <form
            className="mt-1 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (item.trim())
                void act(() =>
                  api('POST', `/tickets/${ticket.id}/checklist`, { text: item.trim() }),
                ).then(() => {
                  setItem('');
                  void checklist.refetch();
                });
            }}
          >
            <label htmlFor="newitem" className="sr-only">
              {t('tickets.checklist')}
            </label>
            <input
              id="newitem"
              className="input mt-0"
              value={item}
              onChange={(e) => setItem(e.target.value)}
            />
            <button type="submit" className="btn-secondary px-2">
              {t('tickets.addItem')}
            </button>
          </form>
        </div>
        <p>{t('tickets.time', { m: ticket.timeSpentMinutes ?? 0 })}</p>
        <button
          type="button"
          className="btn-secondary w-full"
          onClick={() =>
            void act(() =>
              api(ticket.subscribed ? 'DELETE' : 'PUT', `/tickets/${ticket.id}/subscription`),
            )
          }
        >
          {ticket.subscribed ? t('tickets.unsubscribe') : t('tickets.subscribe')}
        </button>
        {macros.length > 0 && (
          <div>
            <h3 className="font-semibold">{t('tickets.macros')}</h3>
            <div className="mt-1 flex flex-wrap gap-1">
              {macros.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="btn-secondary px-2 py-1 text-xs"
                  onClick={() =>
                    void act(() => api('POST', `/tickets/${ticket.id}/macros/${m.id}`))
                  }
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (mergeTarget)
              void act(() =>
                api('POST', `/tickets/${ticket.id}/merge`, { targetId: mergeTarget.trim() }),
              );
          }}
        >
          <label htmlFor="merge" className="label">
            {t('tickets.merge')}
          </label>
          <div className="flex gap-1">
            <input
              id="merge"
              className="input mt-0"
              placeholder={t('tickets.mergeTarget')}
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
            />
            <button type="submit" className="btn-secondary px-2">
              {t('tickets.apply')}
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}

interface HistoryRow {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  actorName: string | null;
  createdAt: string;
}

interface DevOpsLinkRow {
  id: string;
  workItemId: number;
  workItemType: string;
  title: string;
  state: string;
  url: string;
}

/** Azure DevOps work items of the ticket. */
function DevOpsPanel({ ticketId }: { ticketId: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const links = useQuery({
    queryKey: ['ticket', ticketId, 'devops'],
    queryFn: () => api<DevOpsLinkRow[]>('GET', `/tickets/${ticketId}/devops`),
  });
  const [wid, setWid] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setMsg(null);
    try {
      await fn();
      await links.refetch();
    } catch (err) {
      setMsg(errorText(err));
    }
  }
  return (
    <div>
      <h3 className="font-semibold">Azure DevOps</h3>
      <ul>
        {links.data?.map((l) => (
          <li key={l.id}>
            <a className="link" href={l.url} target="_blank" rel="noopener noreferrer">
              {l.workItemType} #{l.workItemId}
            </a>{' '}
            · {l.state} · <span className="text-xs">{l.title}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex flex-wrap gap-1">
        <button
          type="button"
          className="btn-secondary px-2 py-1 text-xs"
          onClick={() => void run(() => api('POST', `/tickets/${ticketId}/devops`, {}))}
        >
          {t('devops.create')}
        </button>
        <input
          aria-label={t('devops.workItem')}
          placeholder={t('devops.workItem')}
          className="input mt-0 w-28"
          inputMode="numeric"
          value={wid}
          onChange={(e) => setWid(e.target.value)}
        />
        <button
          type="button"
          className="btn-secondary px-2 py-1 text-xs"
          disabled={!/^\d+$/.test(wid)}
          onClick={() =>
            void run(() =>
              api('POST', `/tickets/${ticketId}/devops/link`, { workItemId: Number(wid) }),
            ).then(() => setWid(''))
          }
        >
          {t('devops.link')}
        </button>
      </div>
      {msg && <p className="text-red-700">{msg}</p>}
    </div>
  );
}

/** History, links and the customer's other tickets (agents). */
function TicketPanels({ ticketId }: { ticketId: string }) {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const [linkTarget, setLinkTarget] = useState('');
  const [linkType, setLinkType] = useState('related');
  const [msg, setMsg] = useState<string | null>(null);
  const links = useQuery({
    queryKey: ['ticket', ticketId, 'links'],
    queryFn: () =>
      api<
        Array<{
          type: string;
          ticket: { id: string; number: string; title: string; state: string };
        }>
      >('GET', `/tickets/${ticketId}/links`),
  });
  const recent = useQuery({
    queryKey: ['ticket', ticketId, 'recent'],
    queryFn: () =>
      api<Array<{ id: string; number: string; title: string; state: string }>>(
        'GET',
        `/tickets/${ticketId}/customer-tickets`,
      ),
  });
  const history = useQuery({
    queryKey: ['ticket', ticketId, 'history'],
    queryFn: () => api<HistoryRow[]>('GET', `/tickets/${ticketId}/history`),
  });
  return (
    <div className="card space-y-4 text-sm">
      <div>
        <h3 className="font-semibold">{t('tickets.links')}</h3>
        <ul>
          {links.data?.map((l) => (
            <li key={l.ticket.id}>
              {l.type}:{' '}
              <Link to="/tickets/$id" params={{ id: l.ticket.id }} className="link">
                #{l.ticket.number} {l.ticket.title}
              </Link>
            </li>
          ))}
        </ul>
        <form
          className="mt-1 flex gap-1"
          onSubmit={async (e) => {
            e.preventDefault();
            setMsg(null);
            try {
              await api('POST', `/tickets/${ticketId}/links`, {
                targetId: linkTarget.trim(),
                type: linkType,
              });
              setLinkTarget('');
              await links.refetch();
            } catch (err) {
              setMsg(errorText(err));
            }
          }}
        >
          <select
            aria-label={t('tickets.links')}
            className="input mt-0 w-28"
            value={linkType}
            onChange={(e) => setLinkType(e.target.value)}
          >
            <option value="related">related</option>
            <option value="parent">parent</option>
            <option value="child">child</option>
          </select>
          <input
            aria-label={t('tickets.mergeTarget')}
            className="input mt-0"
            placeholder={t('tickets.mergeTarget')}
            value={linkTarget}
            onChange={(e) => setLinkTarget(e.target.value)}
          />
          <button type="submit" className="btn-secondary px-2">
            +
          </button>
        </form>
        {msg && <p className="text-red-700">{msg}</p>}
      </div>
      {(recent.data?.length ?? 0) > 0 && (
        <div>
          <h3 className="font-semibold">{t('tickets.recentOfCustomer')}</h3>
          <ul>
            {recent.data!.map((r) => (
              <li key={r.id}>
                <Link to="/tickets/$id" params={{ id: r.id }} className="link">
                  #{r.number} {r.title}
                </Link>{' '}
                <span className="text-xs">({t(`states.${r.state}`)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <DevOpsPanel ticketId={ticketId} />
      <InncentivesPanel ticketId={ticketId} />
      <details>
        <summary className="cursor-pointer font-semibold">{t('tickets.history')}</summary>
        <ul className="mt-2 space-y-1 text-xs">
          {history.data?.map((h) => (
            <li key={h.id}>
              {formatDate(h.createdAt, i18n.language)} · {h.actorName ?? t('article.types.system')}{' '}
              · <strong>{h.field}</strong>
              {h.oldValue ? `: ${h.oldValue}` : ''}
              {h.newValue ? ` → ${h.newValue}` : ''}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function TicketZoomPage() {
  const { id } = useParams({ from: '/tickets/$id' });
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const staff = me.data?.area === 'agent';
  const meta = useFormMeta();
  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api<TicketDetail>('GET', `/tickets/${id}${staff ? '?open=true' : ''}`),
  });
  const articles = useQuery({
    queryKey: ['ticket', id, 'articles'],
    queryFn: () => api<Article[]>('GET', `/tickets/${id}/articles`),
  });
  const presence = usePresence(id, staff);
  const aiEnabled = useAiEnabled(id, staff);
  const reload = () => void qc.invalidateQueries({ queryKey: ['ticket', id] });
  const navigate = useNavigate();
  const [preset, setPreset] = useState<ComposerPreset | null>(null);

  async function onAction(action: ArticleAction, a: Article) {
    const text = htmlText(a.bodyHtml);
    const k = Date.now();
    if (action === 'split') {
      const r = await api<{ id: string }>('POST', `/tickets/${id}/split`, { articleId: a.id });
      await navigate({ to: '/tickets/$id', params: { id: r.id } });
    } else if (action === 'reply') setPreset({ key: k, type: 'email', to: a.from ?? '' });
    else if (action === 'replyAll')
      setPreset({ key: k, type: 'email', to: a.from ?? '', cc: a.to ?? '' });
    else if (action === 'forward')
      setPreset({
        key: k,
        type: 'email',
        to: '',
        body: `---------- ${t('article.forward')} ----------\n${text}`,
      });
    else
      setPreset({
        key: k,
        type: 'note',
        body: text
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n'),
      });
  }

  if (ticket.isLoading) return <p>{t('common.loading')}</p>;
  if (!ticket.data) return <Alert>{t('errors.not_found')}</Alert>;
  const tk = ticket.data;
  const others = presence.viewers.filter((v) => v.id !== me.data?.user.id);

  return (
    <div className={staff ? 'grid gap-6 lg:grid-cols-[1fr_20rem]' : 'space-y-6'}>
      <div className="space-y-4">
        <header className="card space-y-2">
          <p className="font-mono text-xs text-slate-500">#{tk.number}</p>
          <h1 className="text-xl font-semibold">{tk.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StateBadge state={tk.state} />
            {staff && <SlaBadge ticket={tk} />}
            <span>{tk.priority.name}</span>
            {tk.customer && <span>· {tk.customer.name}</span>}
            {tk.organization && <span>· {tk.organization.name}</span>}
            <span className="text-slate-500">· {formatDate(tk.createdAt, i18n.language)}</span>
          </div>
          {staff && tk.firstResponseDueAt && (
            <p className="text-xs">
              {t('tickets.firstResponseDue')}: {formatDate(tk.firstResponseDueAt, i18n.language)}
            </p>
          )}
          {staff && tk.sensitiveData && <Alert kind="info">⚠ {t('tickets.sensitive')}</Alert>}
          {staff && tk.unverifiedFrom && (
            <Alert kind="info">
              <p>{t('tickets.unverified', { from: tk.unverifiedFrom })}</p>
              <CustomerLink ticketId={tk.id} onDone={reload} />
            </Alert>
          )}
          {others.length > 0 && (
            <p className="text-xs text-amber-700" role="status">
              {t('tickets.viewers', { names: others.map((v) => v.name).join(', ') })}
              {others
                .filter((v) => v.typing)
                .map((v) => (
                  <span key={v.id}> · {t('tickets.typing', { name: v.name })}</span>
                ))}
            </p>
          )}
          {!staff && meta.data?.customerCanClose && tk.state !== 'closed' && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                void api('PATCH', `/tickets/${tk.id}`, { state: 'closed' }).then(reload)
              }
            >
              {t('tickets.close')}
            </button>
          )}
        </header>
        <div className="space-y-3">
          {articles.data?.map((a) => (
            <ArticleView
              key={a.id}
              article={a}
              staff={staff}
              onChanged={reload}
              onAction={staff ? (act, art) => void onAction(act, art) : undefined}
            />
          ))}
        </div>
        {tk.state !== 'merged' && (
          <Composer
            ticketId={tk.id}
            staff={staff}
            onSent={reload}
            onTyping={staff ? presence.setTyping : undefined}
            preset={preset}
            agents={tk.group ? meta.data?.ownersByGroup?.[tk.group.id] : undefined}
            ticketUpdatedAt={tk.updatedAt}
            ai={aiEnabled}
            messaging={(['whatsapp', 'sms'] as const).filter((k) =>
              articles.data?.some((a) => a.type === k && a.sender === 'customer'),
            )}
          />
        )}
      </div>
      {staff && (
        <div className="space-y-4">
          <AgentSidebar ticket={tk} reload={reload} />
          {aiEnabled && (
            <AiPanel
              ticketId={tk.id}
              onSuggestion={(text) => setPreset({ key: Date.now(), type: 'email', body: text })}
            />
          )}
          <TicketPanels ticketId={tk.id} />
        </div>
      )}
    </div>
  );
}
