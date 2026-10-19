import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, takeFragmentToken } from '../api';
import { NewPasswordForm } from '../components/NewPassword';
import { Alert, CenteredCard, Field, useErrorText } from '../components/ui';

export function InvitationPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [token] = useState(() => takeFragmentToken());
  const [info, setInfo] = useState<{
    email: string;
    name: string;
    organizationName: string;
  } | null>(null);
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError(t('errors.token_invalid'));
      return;
    }
    api<{ email: string; name: string; organizationName: string }>(
      'POST',
      '/auth/invitations/inspect',
      { token },
    )
      .then((i) => {
        setInfo(i);
        setName(i.name);
      })
      .catch((err) => setError(errorText(err)));
  }, [token, t, errorText]);

  return (
    <CenteredCard title={t('invite.title')}>
      {done ? (
        <Alert kind="success">
          {t('invite.done')}{' '}
          <Link to="/entrar" className="link">
            {t('login.submit')}
          </Link>
        </Alert>
      ) : info ? (
        <NewPasswordForm
          submitLabel={t('invite.submit')}
          error={error}
          extra={
            <>
              <dl className="text-sm">
                <dt className="font-medium">{t('common.email')}</dt>
                <dd className="mb-2">{info.email}</dd>
                <dt className="font-medium">{t('invite.org')}</dt>
                <dd>{info.organizationName}</dd>
              </dl>
              <Field
                label={t('common.name')}
                name="name"
                value={name}
                onChange={setName}
                autoComplete="name"
              />
            </>
          }
          onSubmit={async (password) => {
            try {
              await api('POST', '/auth/invitations/accept', { token, name, password });
              setDone(true);
            } catch (err) {
              setError(errorText(err));
            }
          }}
        />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : (
        <p>{t('common.loading')}</p>
      )}
    </CenteredCard>
  );
}
