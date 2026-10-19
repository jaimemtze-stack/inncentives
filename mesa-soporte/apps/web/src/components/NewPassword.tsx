import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Field } from './ui';

/** Password + confirmation with the shared length rule (12–128). */
export function NewPasswordForm(props: {
  submitLabel: string;
  onSubmit: (password: string) => Promise<void>;
  extra?: ReactNode;
  error?: string | null;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setLocal(t('password.mismatch'));
    if (password.length < 12 || password.length > 128) return setLocal(t('password.hint'));
    setLocal(null);
    setBusy(true);
    try {
      await props.onSubmit(password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      {(local ?? props.error) && <Alert>{local ?? props.error}</Alert>}
      {props.extra}
      <Field
        label={t('password.new')}
        name="new-password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={t('password.hint')}
      />
      <Field
        label={t('password.confirm')}
        name="confirm-password"
        type="password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
      />
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {props.submitLabel}
      </button>
    </form>
  );
}
