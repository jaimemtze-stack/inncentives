import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Alert, useErrorText } from './ui';

const KINDS = [
  'ticket_created',
  'ticket_assigned',
  'customer_reply',
  'ticket_updated',
  'mention',
  'reminder_reached',
  'sla_warning',
  'sla_breach',
] as const;

interface Prefs {
  notificationPrefs: { email?: Partial<Record<(typeof KINDS)[number], boolean>> };
  outOfOffice: boolean;
  outOfOfficeUntil: string | null;
  replacementId: string | null;
}

/** E-mail notification choices and out-of-office (agents). */
export function PreferencesSection() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const prefs = useQuery({
    queryKey: ['preferences'],
    queryFn: () => api<Prefs>('GET', '/me/preferences'),
  });
  const [state, setState] = useState<Prefs | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  useEffect(() => {
    if (prefs.data) setState(prefs.data);
  }, [prefs.data]);
  if (!state) return null;
  const email = state.notificationPrefs.email ?? {};

  async function save() {
    try {
      await api('PATCH', '/me/preferences', {
        notificationPrefs: state!.notificationPrefs,
        outOfOffice: state!.outOfOffice,
        outOfOfficeUntil: state!.outOfOfficeUntil || null,
        replacementId: state!.replacementId || null,
      });
      setMsg({ kind: 'success', text: t('tickets.saved') });
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    }
  }

  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold">{t('prefs.title')}</h2>
      <fieldset className="grid gap-1 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">{t('prefs.email')}</legend>
        {KINDS.map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={
                email[k] ??
                [
                  'ticket_assigned',
                  'customer_reply',
                  'mention',
                  'reminder_reached',
                  'sla_warning',
                  'sla_breach',
                ].includes(k)
              }
              onChange={(e) =>
                setState({
                  ...state,
                  notificationPrefs: { email: { ...email, [k]: e.target.checked } },
                })
              }
            />
            {t(`prefs.kinds.${k}`)}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.outOfOffice}
          onChange={(e) => setState({ ...state, outOfOffice: e.target.checked })}
        />
        {t('prefs.ooo')}
      </label>
      {state.outOfOffice && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="ooo-until" className="label">
              {t('prefs.until')}
            </label>
            <input
              id="ooo-until"
              type="datetime-local"
              className="input"
              value={state.outOfOfficeUntil ? state.outOfOfficeUntil.slice(0, 16) : ''}
              onChange={(e) =>
                setState({
                  ...state,
                  outOfOfficeUntil: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
            />
          </div>
          <div>
            <label htmlFor="ooo-rep" className="label">
              {t('prefs.replacement')}
            </label>
            <input
              id="ooo-rep"
              className="input"
              value={state.replacementId ?? ''}
              onChange={(e) => setState({ ...state, replacementId: e.target.value })}
            />
          </div>
        </div>
      )}
      <button type="button" className="btn-primary" onClick={() => void save()}>
        {t('common.save')}
      </button>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </section>
  );
}
