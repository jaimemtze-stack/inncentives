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
              </tr>
            </thead>
            <tbody>
              {orgs.data?.items.map((o) => (
                <tr key={o.id}>
                  <td>{o.name}</td>
                  <td>{o.domains.join(', ')}</td>
                  <td>{o.isInternal ? t('admin.internal') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
