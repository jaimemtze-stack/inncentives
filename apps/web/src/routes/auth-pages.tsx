import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Field, Input } from '../components/ui';
import { ApiError, api, tokenFromHash } from '../lib/api';

function useErrorMessage() {
  const { t } = useTranslation();
  return (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.status === 429) return t('auth.tooMany');
      if (e.message === 'invalid_credentials') return t('auth.invalid');
      if (e.message === 'token_invalid') return t('auth.tokenInvalid');
      if (e.message === 'password_breached') return t('auth.breached');
    }
    return t('auth.error');
  };
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ status: string }>('/auth/login', {
        method: 'POST',
        body: { email: form.get('email'), password: form.get('password') },
      });
      await qc.invalidateQueries({ queryKey: ['me'] });
      if (r.status === 'mfa_required') await navigate({ to: '/mfa' });
      else if (r.status === 'mfa_setup_required') await navigate({ to: '/mfa-setup' });
      else await navigate({ to: '/' });
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('auth.signIn')}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {error ? <Alert>{error}</Alert> : null}
        <Field id="email" label={t('auth.email')}>
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </Field>
        <Field id="password" label={t('auth.password')}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>
          {t('auth.signIn')}
        </Button>
        <a className="block text-center text-sm text-brand underline" href="/forgot-password">
          {t('auth.forgot')}
        </a>
      </form>
    </Card>
  );
}

export function MfaPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    try {
      await api('/auth/mfa/verify', { method: 'POST', body: { code } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      await navigate({ to: '/' });
    } catch (err) {
      setError(toMessage(err));
    }
  }

  return (
    <Card title={t('auth.mfaTitle')}>
      <form className="space-y-4" onSubmit={onSubmit}>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('auth.mfaHelp')}</p>
        {error ? <Alert>{error}</Alert> : null}
        <Field id="code" label={t('auth.code')}>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={11}
          />
        </Field>
        <Button type="submit" className="w-full">
          {t('auth.verify')}
        </Button>
      </form>
    </Card>
  );
}

export function MfaSetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toMessage = useErrorMessage();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState<string>('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ secret: string; otpauthUri: string }>('/auth/mfa/setup', { method: 'POST' })
      .then(async (s) => {
        setSetup(s);
        setQr(await QRCode.toDataURL(s.otpauthUri, { margin: 1, width: 200 }));
      })
      .catch((e: unknown) => setError(toMessage(e)));
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    try {
      const r = await api<{ recoveryCodes: string[] }>('/auth/mfa/enable', {
        method: 'POST',
        body: { code },
      });
      setCodes(r.recoveryCodes);
    } catch (err) {
      setError(toMessage(err));
    }
  }

  if (codes) {
    return (
      <Card title={t('auth.recoveryTitle')}>
        <p className="mb-3 text-sm">{t('auth.recoveryHelp')}</p>
        <ul className="mb-4 grid grid-cols-2 gap-2 font-mono text-sm">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button
          className="w-full"
          onClick={async () => {
            await qc.invalidateQueries({ queryKey: ['me'] });
            await navigate({ to: '/' });
          }}
        >
          {t('auth.continue')}
        </Button>
      </Card>
    );
  }

  return (
    <Card title={t('auth.mfaSetupTitle')}>
      <form className="space-y-4" onSubmit={onSubmit}>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('auth.mfaSetupHelp')}</p>
        {error ? <Alert>{error}</Alert> : null}
        {qr ? <img src={qr} alt="QR" className="mx-auto h-48 w-48 rounded bg-white p-2" /> : null}
        {setup ? (
          <p className="break-all text-center font-mono text-xs">
            {t('auth.mfaManual')}: {setup.secret}
          </p>
        ) : null}
        <Field id="code" label={t('auth.code')}>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
          />
        </Field>
        <Button type="submit" className="w-full">
          {t('auth.enable')}
        </Button>
      </form>
    </Card>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  return (
    <Card title={t('auth.forgotTitle')}>
      {sent ? (
        <Alert kind="info">{t('auth.sent')}</Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await api('/auth/password/forgot', {
              method: 'POST',
              body: { email: new FormData(e.currentTarget).get('email') },
            }).catch(() => undefined);
            setSent(true);
          }}
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('auth.forgotHelp')}</p>
          <Field id="email" label={t('auth.email')}>
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </Field>
          <Button type="submit" className="w-full">
            {t('auth.send')}
          </Button>
        </form>
      )}
    </Card>
  );
}

function SetPasswordForm({
  endpoint,
  title,
  done,
}: {
  endpoint: string;
  title: string;
  done: string;
}) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const [token] = useState(() => tokenFromHash());
  const [state, setState] = useState<'idle' | 'done'>('idle');
  const [error, setError] = useState<string | null>(token ? null : t('auth.tokenInvalid'));

  useEffect(() => {
    // Remove the token from the address bar and history.
    if (token) window.history.replaceState(null, '', window.location.pathname);
  }, [token]);

  return (
    <Card title={title}>
      {state === 'done' ? (
        <div className="space-y-4">
          <Alert kind="info">{done}</Alert>
          <a className="block text-center text-sm text-brand underline" href="/login">
            {t('auth.signIn')}
          </a>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const password = String(new FormData(e.currentTarget).get('password') ?? '');
            try {
              await api(endpoint, { method: 'POST', body: { token, password } });
              setState('done');
            } catch (err) {
              setError(toMessage(err));
            }
          }}
        >
          {error ? <Alert>{error}</Alert> : null}
          <Field id="password" label={t('auth.newPassword')} hint={t('auth.passwordHint')}>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              aria-describedby="password-hint"
            />
          </Field>
          <Button type="submit" className="w-full" disabled={!token}>
            {t('auth.save')}
          </Button>
        </form>
      )}
    </Card>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  return (
    <SetPasswordForm
      endpoint="/auth/password/reset"
      title={t('auth.forgotTitle')}
      done={t('auth.resetDone')}
    />
  );
}

export function AcceptInvitationPage() {
  const { t } = useTranslation();
  return (
    <SetPasswordForm
      endpoint="/auth/invitations/accept"
      title={t('auth.acceptTitle')}
      done={t('auth.acceptDone')}
    />
  );
}
