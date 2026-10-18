import { PreferencesSection } from '../components/Preferences';
import { Link } from '@tanstack/react-router';
import type { SessionInfo } from '@mesa/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { RecoveryCodes } from '../components/RecoveryCodes';
import { Alert, Field, useErrorText } from '../components/ui';
import { useMe } from '../session';

export function AccountPage() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const me = useMe();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionInfo[]>('GET', '/auth/sessions'),
  });
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [reauthFor, setReauthFor] = useState<null | (() => Promise<void>)>(null);
  const [reauthPw, setReauthPw] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);

  const user = me.data?.user;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language.startsWith('en') ? 'en-US' : 'es-MX');

  async function withReauth(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'reauthentication_required')
        setReauthFor(() => action);
      else setMsg({ kind: 'error', text: errorText(err) });
    }
  }

  async function confirmReauth(e: FormEvent) {
    e.preventDefault();
    try {
      await api('POST', '/auth/reauth', { password: reauthPw });
      setReauthPw('');
      const action = reauthFor;
      setReauthFor(null);
      if (action) await withReauth(action);
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    try {
      await api('POST', '/auth/password/change', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setMsg({ kind: 'success', text: t('password.changed') });
      await qc.invalidateQueries({ queryKey: ['sessions'] });
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('account.title')}</h1>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {reauthFor && (
        <form className="card space-y-3" onSubmit={confirmReauth}>
          <p className="font-medium">{t('account.reauth')}</p>
          <Field
            label={t('common.password')}
            name="reauth"
            type="password"
            value={reauthPw}
            onChange={setReauthPw}
            autoComplete="current-password"
            autoFocus
          />
          <div className="flex gap-2">
            <button className="btn-primary" type="submit">
              {t('account.confirm')}
            </button>
            <button className="btn-secondary" type="button" onClick={() => setReauthFor(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">{t('account.mfa')}</h2>
        {codes ? (
          <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
        ) : user?.mfaEnabled ? (
          <>
            <p className="text-sm">{t('account.mfaOn')}</p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                withReauth(async () => {
                  const res = await api<{ recoveryCodes: string[] }>(
                    'POST',
                    '/auth/mfa/recovery-codes',
                  );
                  setCodes(res.recoveryCodes);
                })
              }
            >
              {t('account.regenerate')}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm">
              {t('account.mfaOff')} — {t('account.mfaRecommend')}
            </p>
            <Link to="/configurar-mfa" className="btn-primary">
              {t('enroll.start')}
            </Link>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">{t('password.change')}</h2>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={changePassword}>
          <Field
            label={t('password.current')}
            name="current"
            type="password"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
          />
          <Field
            label={t('password.new')}
            name="next"
            type="password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            hint={t('password.hint')}
          />
          <div>
            <button className="btn-primary" type="submit">
              {t('password.change')}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('account.sessions')}</h2>
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              await api('DELETE', '/auth/sessions');
              await qc.invalidateQueries({ queryKey: ['sessions'] });
            }}
          >
            {t('account.revokeOthers')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t('account.lastSeen')}</th>
                <th>IP</th>
                <th>Navegador</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.data?.map((s) => (
                <tr key={s.id}>
                  <td>{fmt(s.lastSeenAt)}</td>
                  <td>{s.ip}</td>
                  <td className="max-w-xs truncate" title={s.userAgent ?? ''}>
                    {s.userAgent}
                  </td>
                  <td>
                    {s.current ? (
                      <span className="text-xs font-semibold text-green-700 dark:text-green-400">
                        {t('account.current')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="link"
                        onClick={async () => {
                          await api('DELETE', `/auth/sessions/${s.id}`);
                          await qc.invalidateQueries({ queryKey: ['sessions'] });
                        }}
                      >
                        {t('account.revoke')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {me.data?.area === 'agent' && <PreferencesSection />}
    </div>
  );
}
