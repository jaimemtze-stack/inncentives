import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Alert, useErrorText } from '../components/ui';

interface Row {
  id: string;
  occurredAt: string;
  action: string;
  actorUserId: string | null;
  ip: string | null;
}

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const rows = useQuery({
    queryKey: ['audit'],
    queryFn: () => api<{ items: Row[] }>('GET', '/admin/audit-logs?limit=100'),
  });
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  async function verify() {
    try {
      const r = await api<{ ok: boolean; checked: number }>('GET', '/admin/audit-logs/verify');
      setMsg({ kind: 'success', text: t('admin.chainOk', { n: r.checked }) });
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('admin.audit')}</h1>
        <button type="button" className="btn-secondary" onClick={verify}>
          {t('admin.verify')}
        </button>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{t('admin.when')}</th>
              <th>{t('admin.action')}</th>
              <th>{t('admin.actor')}</th>
              <th>{t('admin.ip')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.data?.items.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">
                  {new Date(r.occurredAt).toLocaleString(
                    i18n.language.startsWith('en') ? 'en-US' : 'es-MX',
                  )}
                </td>
                <td className="font-mono text-xs">{r.action}</td>
                <td className="font-mono text-xs">{r.actorUserId?.slice(0, 8) ?? '—'}</td>
                <td>{r.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
