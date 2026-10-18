import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { ArticleView } from '../components/ArticleView';
import { Alert, useErrorText } from '../components/ui';
import { formatDate, type Article } from '../lib/tickets';
import { useMe } from '../session';

const EMPTY_COND = { op: 'and', conditions: [] };

/** Starting point for "new" records; the server validates everything. */
const TEMPLATES: Record<string, unknown> = {
  groups: { name: '', emailAddress: null, followUp: 'reopen', autoAssign: false },
  priorities: { name: '', rank: 5 },
  'custom-roles': { name: '', description: '', permissions: ['admin.config'] },
  'support-plans': { name: '', includedMinutesPerMonth: 600 },
  signatures: { name: '', body: '{{agent.name}}\nSoporte Inncentives' },
  calendars: {
    name: '',
    timezone: 'America/Mexico_City',
    hours: {
      '1': [['09:00', '18:30']],
      '2': [['09:00', '18:30']],
      '3': [['09:00', '18:30']],
      '4': [['09:00', '18:30']],
      '5': [['09:00', '18:30']],
    },
    holidays: [],
    mexicoStatutory: true,
  },
  slas: {
    name: '',
    conditions: EMPTY_COND,
    calendarId: '00000000-0000-4000-8000-000000000201',
    targets: [],
  },
  triggers: {
    name: '',
    event: 'create',
    conditions: {
      op: 'and',
      conditions: [{ field: 'ticket.channel', operator: 'is', value: 'email' }],
    },
    actions: [{ type: 'add_tags', tags: ['correo'] }],
  },
  schedulers: {
    name: '',
    intervalMinutes: 60,
    conditions: {
      op: 'and',
      conditions: [{ field: 'ticket.state', operator: 'is', value: 'resolved' }],
    },
    actions: [{ type: 'set', field: 'state', value: 'closed' }],
  },
  'core-workflows': {
    name: '',
    screens: ['create_customer'],
    conditions: EMPTY_COND,
    actions: { 'custom.inncentives_module': { mandatory: true } },
  },
  macros: { name: '', actions: [{ type: 'set', field: 'state', value: 'resolved' }], groupIds: [] },
  'text-modules': { keyword: '', name: '', content: '', locale: 'es-MX' },
  'ticket-templates': { name: '', fields: { title: '', body: '' } },
  overviews: {
    name: '',
    slug: '',
    conditions: EMPTY_COND,
    columns: ['number', 'title', 'state'],
    roles: ['AGENT', 'ADMIN'],
  },
  'object-attributes': {
    object: 'ticket',
    name: '',
    label: '',
    dataType: 'text',
    visibleToCustomer: true,
    editableByCustomer: true,
  },
  'activity-types': { name: '' },
  'email-channels': {
    name: '',
    address: 'soporte@inncentives.com',
    adapter: 'graph',
    groupId: '00000000-0000-4000-8000-000000000301',
    config: { tenantId: '', clientId: '', mailbox: 'soporte@inncentives.com', folder: 'inbox' },
    secretName: 'graph_client_secret',
    trustedAuthServ: 'mx.microsoft.com',
  },
  'postmaster-filters': {
    name: '',
    match: [{ header: 'from', operator: 'ends_with', value: '@ejemplo.mx' }],
    set: { tags: ['ejemplo'] },
  },
  webhooks: { name: '', url: 'https://', secret: '' },
  'teams-channels': {
    groupId: '00000000-0000-4000-8000-000000000301',
    name: '',
    url: 'https://<tenant>.webhook.office.com/…',
    events: ['ticket_created', 'customer_reply', 'sla_breach'],
  },
};

const READ_ONLY = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'lastRunAt',
  'lastFetchAt',
  'lastError',
  'lastStatus',
  'lastCalledAt',
  'hasSecret',
  'hasUrl',
  'target',
  'isTriage',
  'warnings',
]);

/** Runs a call; on "reauthentication_required" asks for the password once and retries. */
function useReauthCall() {
  const { t } = useTranslation();
  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'reauthentication_required') {
        const password = window.prompt(t('config.reauth'));
        if (!password) throw err;
        await api('POST', '/auth/reauth', { password });
        return fn();
      }
      throw err;
    }
  };
}

function ResourceEditor({ resource }: { resource: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const rows = useQuery({
    queryKey: ['config', resource],
    queryFn: () => api<Array<Record<string, unknown>>>('GET', `/admin/config/${resource}`),
  });
  const [editing, setEditing] = useState<{ id: string | null; json: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [log, setLog] = useState<string | null>(null);

  function edit(row: Record<string, unknown> | null) {
    const data = row
      ? Object.fromEntries(Object.entries(row).filter(([k]) => !READ_ONLY.has(k)))
      : (TEMPLATES[resource] ?? {});
    if (row && resource === 'slas' && Array.isArray(row.targets)) {
      (data as Record<string, unknown>).targets = (
        row.targets as Array<Record<string, unknown>>
      ).map(({ slaId: _s, ...x }) => x);
    }
    setEditing({ id: row ? String(row.id) : null, json: JSON.stringify(data, null, 2) });
    setMsg(null);
  }

  async function save() {
    if (!editing) return;
    let body: unknown;
    try {
      body = JSON.parse(editing.json);
    } catch {
      setMsg({ kind: 'error', text: t('config.invalidJson') });
      return;
    }
    try {
      const res = editing.id
        ? await api<{ warnings?: string[] }>(
            'PATCH',
            `/admin/config/${resource}/${editing.id}`,
            body,
          )
        : await api<{ warnings?: string[] }>('POST', `/admin/config/${resource}`, body);
      setEditing(null);
      setMsg(
        res.warnings?.length
          ? { kind: 'info', text: t('config.warnings', { w: res.warnings.join(', ') }) }
          : { kind: 'success', text: t('tickets.saved') },
      );
      await qc.invalidateQueries({ queryKey: ['config', resource] });
      await qc.invalidateQueries({ queryKey: ['form-meta'] });
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('config.confirmDelete'))) return;
    try {
      await api('DELETE', `/admin/config/${resource}/${id}`);
      await qc.invalidateQueries({ queryKey: ['config', resource] });
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    }
  }

  return (
    <div className="space-y-3">
      {resource !== 'retention-policies' && (
        <button type="button" className="btn-primary" onClick={() => edit(null)}>
          {t('config.new')}
        </button>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {editing && (
        <div className="space-y-2">
          <label htmlFor="json" className="label">
            {t('config.json')}
          </label>
          <textarea
            id="json"
            className="input min-h-64 font-mono text-xs"
            value={editing.json}
            onChange={(e) => setEditing({ ...editing, json: e.target.value })}
            spellCheck={false}
          />
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={() => void save()}>
              {t('common.save')}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
      <table className="table">
        <tbody>
          {rows.data?.map((r) => (
            <tr key={String(r.id)}>
              <td>{String(r.name ?? r.keyword ?? r.target ?? r.id)}</td>
              <td className="text-xs text-slate-500">{r.active === false ? '✕' : ''}</td>
              <td className="whitespace-nowrap text-right">
                {(resource === 'webhooks' || resource === 'teams-channels') && (
                  <button
                    type="button"
                    className="link mr-3"
                    aria-expanded={log === String(r.id)}
                    onClick={() => setLog(log === String(r.id) ? null : String(r.id))}
                  >
                    {t('config.deliveries')}
                  </button>
                )}
                <button type="button" className="link mr-3" onClick={() => edit(r)}>
                  {t('config.edit')}
                </button>
                {resource !== 'retention-policies' && (
                  <button
                    type="button"
                    className="text-red-700 underline"
                    onClick={() => void remove(String(r.id))}
                  >
                    {t('config.delete')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {log && <Deliveries targetId={log} />}
    </div>
  );
}

interface Delivery {
  id: string;
  kind: string;
  event: string;
  status: number | null;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

/** Last 100 deliveries of an outgoing webhook or Teams channel. */
function Deliveries({ targetId }: { targetId: string }) {
  const { t } = useTranslation();
  const rows = useQuery({
    queryKey: ['deliveries', targetId],
    queryFn: () =>
      api<Delivery[]>('GET', `/admin/webhook-deliveries?targetId=${encodeURIComponent(targetId)}`),
  });
  if (!rows.data) return null;
  if (!rows.data.length) return <p className="text-sm">{t('config.noDeliveries')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table text-xs">
        <thead>
          <tr>
            <th>{t('config.deliveredAt')}</th>
            <th>{t('config.event')}</th>
            <th>{t('config.status')}</th>
            <th>{t('config.duration')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.data.map((d) => (
            <tr key={d.id}>
              <td>{new Date(d.createdAt).toLocaleString()}</td>
              <td>{d.event}</td>
              <td>
                {d.status !== null && d.status < 300 ? '✓ ' : '✕ '}
                {d.status ?? d.error}
              </td>
              <td>{d.durationMs} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JsonPanel(props: {
  load: () => Promise<unknown>;
  save: (body: unknown) => Promise<unknown>;
  queryKey: string[];
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const reauth = useReauthCall();
  const data = useQuery({ queryKey: props.queryKey, queryFn: props.load });
  const [json, setJson] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const text = json ?? JSON.stringify(data.data ?? {}, null, 2);
  async function save() {
    try {
      await reauth(() => props.save(JSON.parse(text)));
      setMsg({ kind: 'success', text: t('tickets.saved') });
      setJson(null);
      await data.refetch();
    } catch (err) {
      setMsg({
        kind: 'error',
        text: err instanceof SyntaxError ? t('config.invalidJson') : errorText(err),
      });
    }
  }
  return (
    <div className="space-y-2">
      <textarea
        aria-label={t('config.json')}
        className="input min-h-64 font-mono text-xs"
        value={text}
        onChange={(e) => setJson(e.target.value)}
        spellCheck={false}
      />
      <button type="button" className="btn-primary" onClick={() => void save()}>
        {t('common.save')}
      </button>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </div>
  );
}

function UsersPanel() {
  const { t } = useTranslation();
  const users = useQuery({
    queryKey: ['admin-users'],
    queryFn: () =>
      api<{ items: Array<{ id: string; name: string; email: string; role: string }> }>(
        'GET',
        '/admin/users?limit=100',
      ),
  });
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ul className="space-y-1 text-sm">
        {users.data?.items
          .filter((u) => u.role !== 'CUSTOMER')
          .map((u) => (
            <li key={u.id}>
              <button type="button" className="link" onClick={() => setSelected(u.id)}>
                {u.name} · {u.email}
              </button>
            </li>
          ))}
      </ul>
      {selected && (
        <div>
          <h3 className="font-semibold">{t('config.groupAccess')}</h3>
          <p className="mb-2 text-xs text-slate-500">
            [{'{'} "groupId": "…", "levels": ["full"] {'}'}] — read, create, change, overview, full
          </p>
          <JsonPanel
            key={selected}
            queryKey={['admin-user', selected]}
            load={async () =>
              (await api<{ groupAccess: unknown }>('GET', `/admin/users/${selected}`)).groupAccess
            }
            save={(body) => api('PUT', `/admin/users/${selected}/group-access`, body)}
          />
        </div>
      )}
    </div>
  );
}

function PrivacyPanel() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const reauth = useReauthCall();
  const tasks = useQuery({
    queryKey: ['privacy'],
    queryFn: () =>
      api<
        Array<{
          id: string;
          action: string;
          status: string;
          targetUserId: string;
          createdAt: string;
          error: string | null;
        }>
      >('GET', '/admin/privacy-tasks'),
  });
  const [form, setForm] = useState({ userId: '', action: 'export', reason: '' });
  const [msg, setMsg] = useState<string | null>(null);
  async function submit() {
    try {
      await reauth(() => api('POST', '/admin/privacy-tasks', form));
      setForm({ ...form, reason: '' });
      await tasks.refetch();
    } catch (err) {
      setMsg(errorText(err));
    }
  }
  async function download(id: string) {
    const r = await reauth(() =>
      api<{ url: string }>('GET', `/admin/privacy-tasks/${id}/download`),
    );
    window.location.assign(r.url);
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <input
          aria-label={t('config.userId')}
          placeholder={t('config.userId')}
          className="input"
          value={form.userId}
          onChange={(e) => setForm({ ...form, userId: e.target.value })}
        />
        <select
          aria-label={t('config.action')}
          className="input"
          value={form.action}
          onChange={(e) => setForm({ ...form, action: e.target.value })}
        >
          <option value="export">export</option>
          <option value="anonymize">anonymize</option>
          <option value="delete">delete</option>
        </select>
        <input
          aria-label={t('config.reason')}
          placeholder={t('config.reason')}
          className="input"
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <button type="button" className="btn-primary" onClick={() => void submit()}>
          {t('config.start')}
        </button>
      </div>
      {msg && <Alert>{msg}</Alert>}
      <table className="table">
        <tbody>
          {tasks.data?.map((x) => (
            <tr key={x.id}>
              <td>{x.action}</td>
              <td className="font-mono text-xs">{x.targetUserId}</td>
              <td>{x.status}</td>
              <td>{formatDate(x.createdAt, i18n.language)}</td>
              <td>
                {x.action === 'export' && x.status === 'done' && (
                  <button type="button" className="link" onClick={() => void download(x.id)}>
                    {t('article.download')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ViewAsPanel() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const reauth = useReauthCall();
  const [form, setForm] = useState({ userId: '', reason: '' });
  const [session, setSession] = useState<{
    sid: string;
    expiresAt: string;
    customer: { name: string };
  } | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['view-as', session?.sid],
    enabled: !!session,
    queryFn: () =>
      api<{ items: Array<{ id: string; number: string; title: string; state: string }> }>(
        'GET',
        `/admin/view-as/${session!.sid}/tickets?overview=mis-abiertos`,
      ),
  });
  const detail = useQuery({
    queryKey: ['view-as', session?.sid, ticket],
    enabled: !!session && !!ticket,
    queryFn: () =>
      api<{ ticket: { title: string }; articles: Article[] }>(
        'GET',
        `/admin/view-as/${session!.sid}/tickets/${ticket}`,
      ),
  });
  async function start() {
    try {
      setSession(await reauth(() => api('POST', '/admin/view-as', form)));
    } catch (err) {
      setMsg(errorText(err));
    }
  }
  if (!session) {
    return (
      <div className="grid gap-2 sm:grid-cols-3">
        <input
          aria-label={t('config.userId')}
          placeholder={t('config.userId')}
          className="input"
          value={form.userId}
          onChange={(e) => setForm({ ...form, userId: e.target.value })}
        />
        <input
          aria-label={t('config.reason')}
          placeholder={t('config.reason')}
          className="input"
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <button type="button" className="btn-primary" onClick={() => void start()}>
          {t('config.start')}
        </button>
        {msg && <Alert>{msg}</Alert>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div role="status" className="rounded bg-purple-800 px-3 py-2 text-sm text-white">
        {t('config.viewAsBanner', {
          name: session.customer.name,
          until: formatDate(session.expiresAt, i18n.language),
        })}{' '}
        <button type="button" className="underline" onClick={() => setSession(null)}>
          ×
        </button>
      </div>
      <ul className="text-sm">
        {list.data?.items.map((x) => (
          <li key={x.id}>
            <button type="button" className="link" onClick={() => setTicket(x.id)}>
              #{x.number} {x.title}
            </button>
          </li>
        ))}
      </ul>
      {detail.data?.articles.map((a) => (
        <ArticleView key={a.id} article={a} staff={false} onChanged={() => undefined} />
      ))}
    </div>
  );
}

function TokensPanel() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const reauth = useReauthCall();
  const me = useMe();
  const tokens = useQuery({
    queryKey: ['tokens'],
    queryFn: () =>
      api<
        Array<{
          id: string;
          name: string;
          scopes: string[];
          expiresAt: string;
          lastUsedAt: string | null;
          revokedAt: string | null;
        }>
      >('GET', '/me/api-tokens'),
  });
  const [form, setForm] = useState({ name: '', scopes: 'tickets.agent', expiresInDays: 90 });
  const [created, setCreated] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function create() {
    try {
      const r = await reauth(() =>
        api<{ token: string }>('POST', '/me/api-tokens', {
          ...form,
          scopes: form.scopes
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      );
      setCreated(r.token);
      await tokens.refetch();
    } catch (err) {
      setMsg(errorText(err));
    }
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <input
          aria-label={t('common.name')}
          placeholder={t('common.name')}
          className="input"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          aria-label={t('config.scopes')}
          className="input"
          value={form.scopes}
          onChange={(e) => setForm({ ...form, scopes: e.target.value })}
          title={me.data?.permissions.join(', ')}
        />
        <input
          aria-label={t('config.expires')}
          type="number"
          min={1}
          max={365}
          className="input"
          value={form.expiresInDays}
          onChange={(e) => setForm({ ...form, expiresInDays: Number(e.target.value) })}
        />
        <button type="button" className="btn-primary" onClick={() => void create()}>
          {t('config.new')}
        </button>
      </div>
      {created && (
        <Alert kind="success">
          {t('config.tokenOnce')} <code className="break-all">{created}</code>
        </Alert>
      )}
      {msg && <Alert>{msg}</Alert>}
      <table className="table">
        <tbody>
          {tokens.data?.map((x) => (
            <tr key={x.id}>
              <td>{x.name}</td>
              <td className="text-xs">{x.scopes.join(', ')}</td>
              <td>{formatDate(x.expiresAt, i18n.language)}</td>
              <td>
                {!x.revokedAt && (
                  <button
                    type="button"
                    className="text-red-700 underline"
                    onClick={() =>
                      void api('DELETE', `/me/api-tokens/${x.id}`).then(() => tokens.refetch())
                    }
                  >
                    {t('config.delete')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RESOURCE_KEYS = Object.keys(TEMPLATES).concat('retention-policies');

export function ConfigAdminPage() {
  const { t } = useTranslation();
  const me = useMe();
  const can = (p: string) => me.data?.permissions.includes(p) ?? false;
  const [tab, setTab] = useState<string>(can('admin.config') ? 'groups' : 'tokens');
  const special = [
    ...(can('admin.config') ? [['settings', t('config.settings')]] : []),
    ...(can('admin.users.invite_staff') ? [['users', t('config.users')]] : []),
    ...(can('admin.data_privacy') ? [['privacy', t('config.privacy')]] : []),
    ...(can('admin.view_as_customer') ? [['view-as', t('config.viewAs')]] : []),
    ['tokens', t('config.tokens')],
  ];
  return (
    <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
      <nav className="space-y-1 text-sm" aria-label={t('config.title')}>
        {can('admin.config') &&
          RESOURCE_KEYS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setTab(r)}
              className={`block w-full rounded px-3 py-1.5 text-left ${tab === r ? 'bg-blue-50 font-semibold dark:bg-blue-950' : ''}`}
            >
              {t(`config.resources.${r}`)}
            </button>
          ))}
        <hr className="my-2" />
        {special.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k!)}
            className={`block w-full rounded px-3 py-1.5 text-left ${tab === k ? 'bg-blue-50 font-semibold dark:bg-blue-950' : ''}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <section className="card">
        <h1 className="mb-4 text-xl font-semibold">
          {RESOURCE_KEYS.includes(tab)
            ? t(`config.resources.${tab}`)
            : special.find(([k]) => k === tab)?.[1]}
        </h1>
        {RESOURCE_KEYS.includes(tab) && <ResourceEditor key={tab} resource={tab} />}
        {tab === 'settings' && (
          <JsonPanel
            queryKey={['settings']}
            load={() => api('GET', '/admin/settings')}
            save={(b) => api('PUT', '/admin/settings', b)}
          />
        )}
        {tab === 'users' && <UsersPanel />}
        {tab === 'privacy' && <PrivacyPanel />}
        {tab === 'view-as' && <ViewAsPanel />}
        {tab === 'tokens' && <TokensPanel />}
      </section>
    </div>
  );
}
