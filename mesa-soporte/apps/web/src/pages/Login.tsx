import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthState } from '@mesa/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Alert, CenteredCard, Field, useErrorText } from '../components/ui';

export function nextRoute(state: AuthState): '/' | '/verificar' | '/configurar-mfa' {
  if (state === 'mfa_required') return '/verificar';
  if (state === 'mfa_enrollment_required') return '/configurar-mfa';
  return '/';
}

export function LoginPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ state: AuthState }>('POST', '/auth/login', { email, password });
      setPassword('');
      await qc.invalidateQueries({ queryKey: ['me'] });
      await navigate({ to: nextRoute(res.state) });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredCard title={t('login.title')}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        {error && <Alert>{error}</Alert>}
        <Field
          label={t('common.email')}
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          inputMode="email"
          autoFocus
        />
        <Field
          label={t('common.password')}
          name="password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {t('login.submit')}
        </button>
        <p className="text-center text-sm">
          <Link to="/olvide" className="link">
            {t('login.forgot')}
          </Link>
        </p>
      </form>
    </CenteredCard>
  );
}
