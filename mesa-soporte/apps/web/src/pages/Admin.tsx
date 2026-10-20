import { Roles, type Role } from '@mesa/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Alert, Field, useErrorText } from '../components/ui';
import { useMe } from '../session';

interface Org {
  id: string;
  name: string;
  domains: string[];
  isInternal: boolean;
  inncentivesTenantKey: string | null;
  aiEnabled: boolean;
}

/** Inncentives tenant key and AI opt-in of a customer organization. */
function OrgIntegrations({ org, canAi }: { org: Org; canAi: boolean }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const [key, setKey] = useState(org.inncentivesTenantKey ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  async function save(patch: Partial<Org>) {
    setMsg(null);
    try {
      await api('PATCH', `/admin/organizations/${org.id}`, patch);
      await qc.invalidateQueries({ queryKey: ['orgs'] });
      setMsg(t('tickets.saved'));
    } catch (err) {
      setMsg(errorText(err));
    }
  }
  if (org.isInternal) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        aria-label={t('admin.tenantKey', { name: org.name })}
        placeholder={t('admin.tenantKeyHint')}
        className="input mt-0 w-36"
        value={key}
        onChange={(e) => setKey(e.target.value.toLowerCase())}
      />
      <button
        type="button"
        className="btn-secondary px-2 py-1 text-xs"
        onClick={() => void save({ inncentivesTenantKey: key || null })}
      >
        {t('common.save')}
      </button>
      {canAi && (
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={org.aiEnabled}
            onChange={(e) => void save({ aiEnabled: e.target.checked })}
          />
          {t('admin.aiEnabled')}
        </label>
      )}
      {msg && (
        <span role="status" className="text-xs">
          {msg}
        </span>
      )}
    </div>
  );
}

interface ImportReport {
  dryRun: boolean;
  total: number;
  valid: number;
  created: number;
  errors: Array<{ row: number; field: string; message: string }>;
}

/** CSV import of organizations or users: validate first, then apply. */
function CsvImport({ canOrgs }: { canOrgs: boolean }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const [kind, setKind] = useState<'organizations' | 'users'>(canOrgs ? 'organizations' : 'users');
  const [csv, setCsv] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    if (csv === null) return;
    setError(null);
    try {
      const r = await api<ImportReport>('POST', `/admin/import/${kind}`, { csv, dryRun });
      setReport(r);
      if (!dryRun && r.created) await qc.invalidateQueries({ queryKey: ['orgs'] });
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold">{t('csvImport.title')}</h2>
      <p className="text-sm text-plum-600 dark:text-plum-300">{t('csvImport.help')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="imp-kind">
            {t('csvImport.kind')}
          </label>
          <select
            id="imp-kind"
            className="input"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setReport(null);
            }}
          >
            {canOrgs && <option value="organizations">{t('csvImport.organizations')}</option>}
            <option value="users">{t('csvImport.users')}</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="imp-file">
            {t('csvImport.file')}
          </label>
          <input
            id="imp-file"
            className="input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setReport(null);
              if (!f) return setCsv(null);
              if (f.size > 900_000) return setError(errorText(new Error('too_large')));
              void f.text().then(setCsv);
            }}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={csv === null}
          onClick={() => void run(true)}
        >
          {t('csvImport.validate')}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!report?.dryRun || report.errors.length > 0}
          onClick={() => void run(false)}
        >
          {t('csvImport.apply')}
        </button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {report && (
        <div role="status" className="space-y-2">
          <p className="text-sm">
            {t('csvImport.result', {
              valid: report.valid,
              total: report.total,
              created: report.created,
            })}
          </p>
          {report.errors.length > 0 && (
            <>
              <p className="text-sm text-red-800 dark:text-red-300">
                {t('csvImport.nothingWritten')}
              </p>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('csvImport.row')}</th>
                      <th>{t('csvImport.field')}</th>
                      <th>{t('csvImport.error')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.errors.slice(0, 200).map((e, i) => (
                      <tr key={i}>
                        <td>{e.row}</td>
                        <td>{e.field}</td>
                        <td>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function AdminPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const me = useMe();
  const can = (p: string) => me.data?.permissions.includes(p) ?? false;
  const orgs = useQuery({
    queryKey: ['orgs'],
    queryFn: () => api<{ items: Org[] }>('GET', '/admin/organizations?limit=100'),
  });
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [orgName, setOrgName] = useState('');
  const [orgDomains, setOrgDomains] = useState('');
  const [inv, setInv] = useState<{
    email: string;
    name: string;
    role: Role;
    organizationId: string;
  }>({ email: '', name: '', role: 'CUSTOMER', organizationId: '' });

  const roleOptions = Roles.filter((r) => r === 'CUSTOMER' || can('admin.users.invite_staff'));

  async function createOrg(e: FormEvent) {
    e.preventDefault();
    try {
      const domains = orgDomains
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      await api('POST', '/admin/organizations', { name: orgName, domains });
      setOrgName('');
      setOrgDomains('');
      await qc.invalidateQueries({ queryKey: ['orgs'] });
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    }
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    try {
      await api('POST', '/admin/invitations', inv);
      setMsg({ kind: 'success', text: t('admin.invited', { email: inv.email }) });
      setInv({ ...inv, email: '', name: '' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    }
  }

  return (
    <div className="space-y-6">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">{t('admin.invite')}</h2>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={invite}>
          <Field
            label={t('common.email')}
            name="inv-email"
            type="email"
            value={inv.email}
            onChange={(v) => setInv({ ...inv, email: v })}
          />
          <Field
            label={t('common.name')}
            name="inv-name"
            value={inv.name}
            onChange={(v) => setInv({ ...inv, name: v })}
          />
          <div>
            <label className="label" htmlFor="inv-role">
              {t('admin.role')}
            </label>
            <select
              id="inv-role"
              className="input"
              value={inv.role}
              onChange={(e) => setInv({ ...inv, role: e.target.value as Role })}
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {t(`admin.roles.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="inv-org">
              {t('admin.organization')}
            </label>
            <select
              id="inv-org"
              className="input"
              required
              value={inv.organizationId}
              onChange={(e) => setInv({ ...inv, organizationId: e.target.value })}
            >
              <option value="" />
              {orgs.data?.items
                .filter((o) => (inv.role === 'CUSTOMER' ? !o.isInternal : o.isInternal))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <button className="btn-primary" type="submit">
              {t('admin.sendInvite')}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">{t('admin.organizations')}</h2>
        {can('admin.organizations.write') && (
          <form className="mb-4 grid gap-3 sm:grid-cols-3" onSubmit={createOrg}>
            <Field label={t('common.name')} name="org-name" value={orgName} onChange={setOrgName} />
            <Field
              label={t('admin.domains')}
              name="org-domains"
              value={orgDomains}
              onChange={setOrgDomains}
              required={false}
            />
            <div className="self-end">
              <button className="btn-primary" type="submit">
                {t('admin.create')}
              </button>
            </div>
          </form>
        )}
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('admin.domains')}</th>
                <th />
                <th>{t('admin.integrations')}</th>
              </tr>
            </thead>
            <tbody>
              {orgs.data?.items.map((o) => (
                <tr key={o.id}>
                  <td>{o.name}</td>
                  <td>{o.domains.join(', ')}</td>
                  <td>{o.isInternal ? t('admin.internal') : ''}</td>
                  <td>
                    {can('admin.organizations.write') && (
                      <OrgIntegrations org={o} canAi={can('admin.config')} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {can('admin.users.invite_customer') && (
        <CsvImport canOrgs={can('admin.organizations.write')} />
      )}
    </div>
  );
}
