import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { GroupAccessForm } from '../components/config/forms';
import type { Rec } from '../components/config/fields';
import { Icon } from '../components/Icon';
import { useReauth } from '../components/Reauth';
import { Alert, useErrorText } from '../components/ui';
import { formatDate } from '../lib/tickets';
import { useMe } from '../session';

type Role = 'ADMIN' | 'AGENT' | 'CUSTOMER';
type Status = 'ACTIVE' | 'DISABLED';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: Status;
  organization: { id: string; name: string };
  mfaEnabled: boolean;
  lastLoginAt: string | null;
}

interface UserDetail extends UserRow {
  phone: string | null;
  mobile: string | null;
  orgTicketAccess: boolean;
  mfa: { totp: boolean; passkeys: number; recoveryCodes: number };
  groupAccess: Rec[];
  customRoleIds: string[];
  secondaryOrganizationIds: string[];
}

interface Org {
  id: string;
  name: string;
  isInternal: boolean;
}

interface Invitation {
  id: string;
  email: string;
  name: string;
  role: Role;
  expiresAt: string;
  expired: boolean;
  organization: { id: string; name: string };
}

const ROLE_CHIP: Record<Role, string> = {
  ADMIN: 'bg-navy-100 text-navy-800 dark:bg-navy-800 dark:text-navy-100',
  AGENT: 'bg-brand-100 text-brand-900 dark:bg-brand-900 dark:text-brand-100',
  CUSTOMER: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
};

function RoleChip({ role }: { role: Role }) {
  const { t } = useTranslation();
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_CHIP[role]}`}
    >
      {t(`users.roles.${role}`)}
    </span>
  );
}

function StatusChip({ status }: { status: Status }) {
  const { t } = useTranslation();
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${
        status === 'ACTIVE'
          ? 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200'
          : 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200'
      }`}
    >
      {t(`users.statuses.${status}`)}
    </span>
  );
}

function useOrganizations() {
  return useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () => api<{ items: Org[] }>('GET', '/admin/organizations?limit=100'),
    staleTime: 60_000,
  });
}

/** Turns the API's validation messages for role changes into readable text. */
function useUserErrorText() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  return (err: unknown) => {
    if (err instanceof ApiError && /only active administrator/i.test(err.message))
      return t('users.lastAdmin');
    if (
      err instanceof ApiError &&
      /organization/i.test(err.message) &&
      err.code === 'validation_failed'
    )
      return t('users.orgRule');
    return errorText(err);
  };
}

/** Two-step button: the first click asks, the second one acts. */
function ConfirmButton(props: {
  label: string;
  question: string;
  onConfirm: () => void;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        type="button"
        className={props.danger ? 'btn-danger' : 'btn-secondary'}
        onClick={() => setAsking(true)}
      >
        {props.label}
      </button>
    );
  return (
    <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950">
      <p>{props.question}</p>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-danger"
          onClick={() => {
            setAsking(false);
            props.onConfirm();
          }}
        >
          {t('users.confirmYes')}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setAsking(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

function UserPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const can = (p: string) => me.data?.permissions.includes(p) ?? false;
  const canEdit = can('admin.users.invite_staff');
  const canSecurity = can('admin.users.manage_sessions');
  const self = me.data?.user.id === id;
  const errorText = useUserErrorText();
  const reauth = useReauth();
  const qc = useQueryClient();
  const orgs = useOrganizations();
  const customRoles = useQuery({
    queryKey: ['config', 'custom-roles'],
    enabled: can('admin.config'),
    queryFn: () => api<Array<{ id: string; name: string }>>('GET', '/admin/config/custom-roles'),
  });
  const user = useQuery({
    queryKey: ['admin-user-detail', id],
    queryFn: () => api<UserDetail>('GET', `/admin/users/${id}`),
  });
  const [draft, setDraft] = useState<UserDetail | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  useEffect(() => {
    if (user.data) setDraft(structuredClone(user.data));
  }, [user.data]);

  if (!user.data || !draft) return <p className="text-sm">{t('common.loading')}</p>;
  const original = user.data;
  const isCustomer = draft.role === 'CUSTOMER';
  const orgOptions = (orgs.data?.items ?? []).filter((o) => o.isInternal === !isCustomer);
  const set = (patch: Partial<UserDetail>) => setDraft({ ...draft, ...patch });

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['admin-user-detail', id] });
    await qc.invalidateQueries({ queryKey: ['admin-users'] });
    onChanged();
  }

  async function act<T>(fn: () => Promise<T>, success: string | ((r: T) => string)) {
    setMsg(null);
    try {
      await reauth.run(async () => {
        const r = await fn();
        setMsg({ kind: 'success', text: typeof success === 'string' ? success : success(r) });
        await refresh();
      });
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    }
  }

  function save() {
    const d = draft!;
    const body: Rec = {};
    if (d.name !== original.name) body.name = d.name;
    if ((d.phone ?? '') !== (original.phone ?? '')) body.phone = d.phone ?? '';
    if ((d.mobile ?? '') !== (original.mobile ?? '')) body.mobile = d.mobile ?? '';
    if (d.role !== original.role) body.role = d.role;
    if (d.organization.id !== original.organization.id) body.organizationId = d.organization.id;
    if (d.role === 'CUSTOMER') {
      if (d.orgTicketAccess !== original.orgTicketAccess) body.orgTicketAccess = d.orgTicketAccess;
      if (d.secondaryOrganizationIds.join() !== original.secondaryOrganizationIds.join())
        body.secondaryOrganizationIds = d.secondaryOrganizationIds;
    } else if (can('admin.config') && d.customRoleIds.join() !== original.customRoleIds.join()) {
      body.customRoleIds = d.customRoleIds;
    }
    const accessChanged =
      d.role !== 'CUSTOMER' &&
      JSON.stringify(d.groupAccess) !== JSON.stringify(original.groupAccess);
    void act(async () => {
      if (Object.keys(body).length) await api('PATCH', `/admin/users/${id}`, body);
      if (accessChanged) await api('PUT', `/admin/users/${id}/group-access`, d.groupAccess);
    }, t('users.saved'));
  }

  const disabledEdit = !canEdit;
  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{original.name}</h2>
          <RoleChip role={original.role} />
          <StatusChip status={original.status} />
        </div>
        <p className="text-sm text-ink-500">{original.email}</p>
      </div>
      {reauth.dialog}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {!canEdit && <Alert kind="info">{t('users.readOnly')}</Alert>}
      {canEdit && self && <Alert kind="info">{t('users.self')}</Alert>}

      <fieldset className="space-y-3" disabled={disabledEdit}>
        <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-500">
          {t('users.details')}
        </legend>
        <div>
          <label className="label" htmlFor="u-name">
            {t('common.name')}
          </label>
          <input
            id="u-name"
            className="input"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="u-phone">
              {t('users.phone')}
            </label>
            <input
              id="u-phone"
              className="input"
              value={draft.phone ?? ''}
              onChange={(e) => set({ phone: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="u-mobile">
              {t('users.mobile')}
            </label>
            <input
              id="u-mobile"
              className="input"
              value={draft.mobile ?? ''}
              onChange={(e) => set({ mobile: e.target.value })}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3" disabled={disabledEdit || self}>
        <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-500">
          {t('users.roleAndOrg')}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="u-role">
              {t('users.role')}
            </label>
            <select
              id="u-role"
              className="input"
              value={draft.role}
              onChange={(e) => {
                const role = e.target.value as Role;
                const wasCustomer = draft.role === 'CUSTOMER';
                const nowCustomer = role === 'CUSTOMER';
                // Crossing staff ↔ customer needs an organization of the other kind.
                set({
                  role,
                  organization:
                    wasCustomer === nowCustomer
                      ? draft.organization
                      : role === original.role
                        ? original.organization
                        : { id: '', name: '' },
                });
              }}
            >
              {(['ADMIN', 'AGENT', 'CUSTOMER'] as const).map((r) => (
                <option key={r} value={r}>
                  {t(`users.roles.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="u-org">
              {t('users.organization')}
            </label>
            <select
              id="u-org"
              className="input"
              value={draft.organization.id}
              onChange={(e) =>
                set({
                  organization: {
                    id: e.target.value,
                    name: orgOptions.find((o) => o.id === e.target.value)?.name ?? '',
                  },
                })
              }
            >
              {!draft.organization.id && <option value="">—</option>}
              {orgOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-ink-500">{t('users.roleHint')}</p>
      </fieldset>

      {isCustomer ? (
        <fieldset className="space-y-3" disabled={disabledEdit}>
          <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-500">
            {t('users.customerAccess')}
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.orgTicketAccess}
              onChange={(e) => set({ orgTicketAccess: e.target.checked })}
            />
            {t('users.orgTicketAccess')}
          </label>
          <div>
            <p className="label">{t('users.secondaryOrgs')}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {orgOptions
                .filter((o) => o.id !== draft.organization.id)
                .map((o) => (
                  <label key={o.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.secondaryOrganizationIds.includes(o.id)}
                      onChange={(e) =>
                        set({
                          secondaryOrganizationIds: e.target.checked
                            ? [...draft.secondaryOrganizationIds, o.id]
                            : draft.secondaryOrganizationIds.filter((x) => x !== o.id),
                        })
                      }
                    />
                    {o.name}
                  </label>
                ))}
            </div>
          </div>
        </fieldset>
      ) : (
        <fieldset className="space-y-3" disabled={disabledEdit}>
          <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-500">
            {t('users.staffAccess')}
          </legend>
          {customRoles.data && (
            <fieldset disabled={self}>
              <legend className="label">{t('users.customRoles')}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {customRoles.data.map((r) => (
                  <label key={r.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.customRoleIds.includes(r.id)}
                      onChange={(e) =>
                        set({
                          customRoleIds: e.target.checked
                            ? [...draft.customRoleIds, r.id]
                            : draft.customRoleIds.filter((x) => x !== r.id),
                        })
                      }
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div>
            <p className="label">{t('users.groupAccess')}</p>
            <GroupAccessForm
              value={draft.groupAccess}
              onChange={(groupAccess) => set({ groupAccess })}
            />
          </div>
        </fieldset>
      )}

      {canEdit && (
        <button
          type="button"
          className="btn-primary"
          disabled={!draft.name.trim() || !draft.organization.id}
          onClick={save}
        >
          {t('users.save')}
        </button>
      )}

      <section className="space-y-3 border-t border-ink-200 pt-4 dark:border-ink-700">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          {t('users.security')}
        </h3>
        <p className="text-sm">
          <span className="font-medium">{t('users.mfaState')}:</span>{' '}
          {original.mfaEnabled ? t('account.mfaOn') : t('account.mfaOff')}
          <br />
          <span className="text-xs text-ink-500">
            {t('users.mfaDetail', {
              totp: original.mfa.totp ? t('users.yes') : t('users.no'),
              passkeys: original.mfa.passkeys,
              codes: original.mfa.recoveryCodes,
            })}
          </span>
        </p>
        <p className="text-sm">
          <span className="font-medium">{t('users.lastLogin')}:</span>{' '}
          {original.lastLoginAt
            ? formatDate(original.lastLoginAt, i18n.language)
            : t('users.never')}
        </p>
        {canSecurity && !self && (
          <div className="flex flex-wrap items-start gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                void act(
                  () => api<{ revoked: number }>('POST', `/admin/users/${id}/sessions/revoke`),
                  (r) => t('users.sessionsRevoked', { n: r.revoked }),
                )
              }
            >
              {t('users.revokeSessions')}
            </button>
            {original.mfaEnabled && (
              <ConfirmButton
                label={t('users.resetMfa')}
                question={t('users.resetMfaConfirm')}
                danger
                onConfirm={() =>
                  void act(
                    () => api('POST', `/admin/users/${id}/mfa/reset`),
                    t('users.resetMfaDone'),
                  )
                }
              />
            )}
          </div>
        )}
      </section>

      {canEdit && !self && (
        <section className="space-y-3 border-t border-ink-200 pt-4 dark:border-ink-700">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            {t('users.account')}
          </h3>
          {original.status === 'ACTIVE' ? (
            <ConfirmButton
              label={t('users.disable')}
              question={t('users.disableConfirm')}
              danger
              onConfirm={() =>
                void act(
                  () => api('PATCH', `/admin/users/${id}`, { status: 'DISABLED' }),
                  t('users.disabled'),
                )
              }
            />
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                void act(
                  () => api('PATCH', `/admin/users/${id}`, { status: 'ACTIVE' }),
                  t('users.enabled'),
                )
              }
            >
              {t('users.enable')}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function PendingInvitations() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['admin-invitations'],
    queryFn: () => api<Invitation[]>('GET', '/admin/invitations'),
  });
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  async function act(fn: () => Promise<unknown>, success: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'success', text: success });
      await qc.invalidateQueries({ queryKey: ['admin-invitations'] });
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    }
  }
  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold">{t('users.pending')}</h2>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {!list.data?.length ? (
        <p className="text-sm text-ink-500">{t('users.pendingEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('users.role')}</th>
                <th>{t('users.organization')}</th>
                <th>{t('users.expires')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <div className="font-medium">{inv.name}</div>
                    <div className="text-xs text-ink-500">{inv.email}</div>
                  </td>
                  <td>
                    <RoleChip role={inv.role} />
                  </td>
                  <td>{inv.organization.name}</td>
                  <td className={inv.expired ? 'text-red-700 dark:text-red-400' : ''}>
                    {inv.expired ? t('users.expired') : formatDate(inv.expiresAt, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <button
                      type="button"
                      className="link mr-3"
                      onClick={() =>
                        void act(
                          () => api('POST', `/admin/invitations/${inv.id}/resend`),
                          t('users.resent', { email: inv.email }),
                        )
                      }
                    >
                      {t('users.resend')}
                    </button>
                    <button
                      type="button"
                      className="text-red-700 underline dark:text-red-400"
                      onClick={() =>
                        void act(
                          () => api('DELETE', `/admin/invitations/${inv.id}`),
                          t('users.revoked'),
                        )
                      }
                    >
                      {t('users.revoke')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Users of the desk: search, filters, details and administration. */
export function UsersPage() {
  const { t } = useTranslation();
  const me = useMe();
  const orgs = useOrganizations();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [org, setOrg] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const params = new URLSearchParams({ limit: '50' });
  if (search) params.set('q', search);
  if (role) params.set('role', role);
  if (status) params.set('status', status);
  if (org) params.set('organizationId', org);
  const list = useInfiniteQuery({
    queryKey: ['admin-users', params.toString()],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<{ items: UserRow[]; nextCursor?: string }>(
        'GET',
        `/admin/users?${params.toString()}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const canInvite = me.data?.permissions.includes('admin.users.invite_customer') ?? false;

  return (
    <div className="space-y-5">
      <div className="page-header mb-0">
        <h1 className="page-title">{t('users.title')}</h1>
        {canInvite && (
          <Link to="/admin" className="btn-primary">
            {t('users.invite')}
          </Link>
        )}
      </div>

      <div className="card flex flex-wrap items-end gap-3 py-4">
        <form
          role="search"
          className="flex min-w-[16rem] flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
        >
          <label htmlFor="users-q" className="sr-only">
            {t('users.search')}
          </label>
          <Icon name="search" className="h-5 w-5 shrink-0 text-ink-500" />
          <input
            id="users-q"
            className="input mt-0"
            placeholder={t('users.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => setSearch(q.trim())}
          />
        </form>
        <select
          aria-label={t('users.role')}
          className="input mt-0 w-auto"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="">{t('users.allRoles')}</option>
          {(['ADMIN', 'AGENT', 'CUSTOMER'] as const).map((r) => (
            <option key={r} value={r}>
              {t(`users.roles.${r}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('users.status')}
          className="input mt-0 w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('users.allStatus')}</option>
          {(['ACTIVE', 'DISABLED'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`users.statuses.${s}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('users.organization')}
          className="input mt-0 w-auto max-w-[16rem]"
          value={org}
          onChange={(e) => setOrg(e.target.value)}
        >
          <option value="">{t('users.allOrgs')}</option>
          {orgs.data?.items.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <section className="card overflow-hidden p-0">
          {!rows.length && !list.isLoading ? (
            <p className="px-6 py-10 text-center text-sm text-ink-500">{t('users.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="pl-4">{t('common.name')}</th>
                    <th>{t('users.role')}</th>
                    <th>{t('users.organization')}</th>
                    <th>{t('users.status')}</th>
                    <th>{t('users.mfa')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr
                      key={u.id}
                      className={selected === u.id ? 'bg-brand-50 dark:bg-brand-950' : ''}
                    >
                      <td className="pl-4">
                        <button
                          type="button"
                          className="text-left font-medium hover:text-brand-800 hover:underline dark:hover:text-brand-300"
                          aria-pressed={selected === u.id}
                          onClick={() => setSelected(u.id)}
                        >
                          {u.name}
                        </button>
                        <div className="text-xs text-ink-500">{u.email}</div>
                      </td>
                      <td>
                        <RoleChip role={u.role} />
                      </td>
                      <td>{u.organization.name}</td>
                      <td>
                        <StatusChip status={u.status} />
                      </td>
                      <td>{u.mfaEnabled ? t('users.yes') : t('users.no')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.hasNextPage && (
            <div className="p-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void list.fetchNextPage()}
              >
                {t('users.more')}
              </button>
            </div>
          )}
        </section>
        <aside className="card self-start lg:sticky lg:top-6">
          {selected ? (
            <UserPanel key={selected} id={selected} onChanged={() => undefined} />
          ) : (
            <p className="text-sm text-ink-500">{t('users.select')}</p>
          )}
        </aside>
      </div>

      {canInvite && <PendingInvitations />}
    </div>
  );
}
