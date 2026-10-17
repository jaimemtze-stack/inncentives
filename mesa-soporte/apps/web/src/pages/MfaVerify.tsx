import { Navigate, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { Alert, CenteredCard, Field, useErrorText } from '../components/ui';
import { useMe } from '../session';

export function MfaVerifyPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (me.isLoading) return null;
  if (!me.data) return <Navigate to="/entrar" />;
  if (me.data.state !== 'mfa_required') return <Navigate to="/" />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(
        'POST',
        '/auth/mfa/verify',
        useRecovery ? { recoveryCode: value.trim().toLowerCase() } : { code: value.trim() },
      );
      await qc.invalidateQueries({ queryKey: ['me'] });
      await navigate({ to: '/' });
    } catch (err) {
      setValue('');
      if (err instanceof ApiError && err.code === 'unauthenticated') {
        await qc.invalidateQueries({ queryKey: ['me'] });
      }
      setError(errorText(err));
    }
  }

  return (
    <CenteredCard title={t('mfa.title')}>
      <form className="space-y-4" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        {useRecovery ? (
          <Field
            label={t('mfa.recovery')}
            name="recovery"
            value={value}
            onChange={setValue}
            autoComplete="off"
            pattern="[a-z0-9]{5}-[a-z0-9]{5}"
            maxLength={11}
            autoFocus
          />
        ) : (
          <Field
            label={t('mfa.code')}
            name="code"
            value={value}
            onChange={setValue}
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoFocus
          />
        )}
        <button type="submit" className="btn-primary w-full">
          {t('mfa.submit')}
        </button>
        <button
          type="button"
          className="link w-full text-center text-sm"
          onClick={() => {
            setUseRecovery(!useRecovery);
            setValue('');
          }}
        >
          {useRecovery ? t('mfa.useCode') : t('mfa.useRecovery')}
        </button>
      </form>
    </CenteredCard>
  );
}
