import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { Alert, Field, useErrorText } from './ui';

/**
 * Runs actions that may need a fresh password. When the API answers
 * "reauthentication_required", `dialog` asks for the password in the page
 * and retries the action once confirmed.
 */
export function useReauth(): {
  run: (action: () => Promise<void>) => Promise<void>;
  dialog: ReactNode;
} {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [pending, setPending] = useState<null | (() => Promise<void>)>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'reauthentication_required') {
        setPending(() => action);
        return;
      }
      throw err;
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    try {
      await api('POST', '/auth/reauth', { password });
    } catch (err) {
      setError(errorText(err));
      return;
    }
    const action = pending;
    setPassword('');
    setError(null);
    setPending(null);
    if (action) await action();
  }

  const dialog = pending ? (
    <form className="card space-y-3 border-brand-400" onSubmit={(e) => void confirm(e)}>
      <p className="font-medium">{t('account.reauth')}</p>
      <Field
        label={t('common.password')}
        name="reauth"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        autoFocus
      />
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <button className="btn-primary" type="submit">
          {t('account.confirm')}
        </button>
        <button className="btn-secondary" type="button" onClick={() => setPending(null)}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  ) : null;

  return { run, dialog };
}
