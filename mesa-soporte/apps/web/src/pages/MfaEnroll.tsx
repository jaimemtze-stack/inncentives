import { registerPasskey } from '../components/Passkeys';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { RecoveryCodes } from '../components/RecoveryCodes';
import { Alert, CenteredCard, Field, useErrorText } from '../components/ui';
import { useMe } from '../session';

export function MfaEnrollPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One setup request per visit (StrictMode runs effects twice in development).
  const started = useRef(false);

  const allowed =
    me.data &&
    (me.data.state === 'mfa_enrollment_required' ||
      (me.data.state === 'authenticated' && !me.data.user.mfaEnabled));

  useEffect(() => {
    if (!allowed || started.current) return;
    started.current = true;
    api<{ secret: string; otpauthUri: string }>('POST', '/auth/mfa/totp/setup')
      .then(async (s) =>
        setSetup({
          secret: s.secret,
          qr: await QRCode.toDataURL(s.otpauthUri, { margin: 1, width: 220 }),
        }),
      )
      .catch((err) => setError(errorText(err)));
  }, [allowed, errorText]);

  if (me.isLoading) return null;
  if (!me.data) return <Navigate to="/entrar" />;
  if (codes) {
    return (
      <CenteredCard title={t('enroll.title')}>
        <RecoveryCodes
          codes={codes}
          onDone={async () => {
            await qc.invalidateQueries({ queryKey: ['me'] });
            await navigate({ to: '/' });
          }}
        />
      </CenteredCard>
    );
  }
  if (!allowed) return <Navigate to="/" />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ recoveryCodes: string[] }>('POST', '/auth/mfa/totp/confirm', {
        code: code.trim(),
      });
      setCodes(res.recoveryCodes);
    } catch (err) {
      setCode('');
      setError(errorText(err));
    }
  }

  return (
    <CenteredCard title={t('enroll.title')}>
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-sm text-ink-600 dark:text-ink-400">{t('enroll.intro')}</p>
        {error && <Alert>{error}</Alert>}
        {setup && (
          <>
            <img
              src={setup.qr}
              alt="QR"
              className="mx-auto rounded bg-white p-2"
              width={220}
              height={220}
            />
            <p className="text-xs text-ink-500">{t('enroll.manual')}</p>
            <code
              className="block break-all rounded bg-ink-100 p-2 text-center text-sm dark:bg-ink-800"
              data-testid="totp-secret"
            >
              {setup.secret}
            </code>
          </>
        )}
        <Field
          label={t('mfa.code')}
          name="code"
          value={code}
          onChange={setCode}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
        />
        <button type="submit" className="btn-primary w-full" disabled={!setup}>
          {t('enroll.confirm')}
        </button>
        <button
          type="button"
          className="btn-secondary w-full"
          onClick={async () => {
            try {
              const recovery = await registerPasskey(t('passkeys.defaultName'));
              if (recovery) setCodes(recovery);
            } catch (err) {
              if (err instanceof Error && err.name === 'NotAllowedError') return;
              setError(errorText(err));
            }
          }}
        >
          {t('passkeys.enrollInstead')}
        </button>
      </form>
    </CenteredCard>
  );
}
