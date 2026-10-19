import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Alert, CenteredCard, Field, useErrorText } from '../components/ui';

export function ForgotPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('POST', '/auth/password/forgot', { email });
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <CenteredCard title={t('forgot.title')}>
      {sent ? (
        <Alert kind="success">{t('forgot.sent')}</Alert>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          {error && <Alert>{error}</Alert>}
          <Field
            label={t('common.email')}
            name="email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="username"
          />
          <button className="btn-primary w-full" type="submit">
            {t('forgot.submit')}
          </button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link to="/entrar" className="link">
          {t('common.back')}
        </Link>
      </p>
    </CenteredCard>
  );
}
