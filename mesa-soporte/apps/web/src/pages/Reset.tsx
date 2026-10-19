import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, takeFragmentToken } from '../api';
import { NewPasswordForm } from '../components/NewPassword';
import { Alert, CenteredCard, useErrorText } from '../components/ui';

export function ResetPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [token] = useState(() => takeFragmentToken());
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : t('errors.token_invalid'));

  return (
    <CenteredCard title={t('reset.title')}>
      {done ? (
        <Alert kind="success">
          {t('reset.done')}{' '}
          <Link to="/entrar" className="link">
            {t('login.submit')}
          </Link>
        </Alert>
      ) : token ? (
        <NewPasswordForm
          submitLabel={t('reset.submit')}
          error={error}
          onSubmit={async (password) => {
            try {
              await api('POST', '/auth/password/reset', { token, password });
              setDone(true);
            } catch (err) {
              setError(errorText(err));
            }
          }}
        />
      ) : (
        <Alert>{error}</Alert>
      )}
    </CenteredCard>
  );
}
