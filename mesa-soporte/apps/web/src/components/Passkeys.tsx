import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Alert, useErrorText } from './ui';

/** Second factor with a passkey / security key (sign-in step). */
export async function verifyWithPasskey(): Promise<void> {
  const options = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
    'POST',
    '/auth/webauthn/authenticate/options',
  );
  const response = await startAuthentication({ optionsJSON: options });
  await api('POST', '/auth/webauthn/authenticate', { response });
}

/** Registers a passkey; returns recovery codes when it was the first factor. */
export async function registerPasskey(name: string): Promise<string[] | undefined> {
  const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>(
    'POST',
    '/auth/webauthn/register/options',
  );
  const response = await startRegistration({ optionsJSON: options });
  const r = await api<{ recoveryCodes?: string[] }>('POST', '/auth/webauthn/register', {
    name,
    response,
  });
  return r.recoveryCodes;
}

/** Account section: passkeys and linked single sign-on identities. */
export function SecurityKeysSection({
  withReauth,
}: {
  withReauth: (fn: () => Promise<void>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const keys = useQuery({
    queryKey: ['passkeys'],
    queryFn: () =>
      api<Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }>>(
        'GET',
        '/auth/webauthn/credentials',
      ),
  });
  const providers = useQuery({
    queryKey: ['sso-providers'],
    queryFn: () => api<Array<{ id: string; label: string }>>('GET', '/auth/sso/providers'),
  });
  const identities = useQuery({
    queryKey: ['sso-identities'],
    queryFn: () =>
      api<Array<{ id: string; provider: string; email: string | null }>>(
        'GET',
        '/auth/sso/identities',
      ),
  });
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  async function add() {
    setMsg(null);
    await withReauth(async () => {
      try {
        await registerPasskey(name.trim() || t('passkeys.defaultName'));
        setName('');
        setMsg({ kind: 'success', text: t('passkeys.added') });
        await keys.refetch();
      } catch (err) {
        if (err instanceof Error && err.name === 'NotAllowedError') return;
        throw err;
      }
    });
  }

  return (
    <section className="card space-y-4">
      <h2 className="text-lg font-semibold">{t('passkeys.title')}</h2>
      <ul className="text-sm" data-testid="passkeys">
        {keys.data?.map((k) => (
          <li key={k.id} className="flex items-center justify-between">
            <span>🔑 {k.name}</span>
            <button
              type="button"
              className="link"
              onClick={() =>
                void withReauth(async () => {
                  await api('DELETE', `/auth/webauthn/credentials/${k.id}`);
                  await keys.refetch();
                }).catch((err) => setMsg({ kind: 'error', text: errorText(err) }))
              }
            >
              {t('account.revoke')}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <label htmlFor="pkname" className="sr-only">
          {t('passkeys.name')}
        </label>
        <input
          id="pkname"
          className="input mt-0"
          placeholder={t('passkeys.name')}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void add().catch((err) => setMsg({ kind: 'error', text: errorText(err) }))}
        >
          {t('passkeys.add')}
        </button>
      </div>
      {(providers.data?.length ?? 0) > 0 && (
        <div className="space-y-2 text-sm">
          <h3 className="font-semibold">{t('sso.linked')}</h3>
          <ul>
            {identities.data?.map((i) => (
              <li key={i.id} className="flex justify-between">
                <span>
                  {i.provider} {i.email ? `· ${i.email}` : ''}
                </span>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    void withReauth(async () => {
                      await api('DELETE', `/auth/sso/identities/${i.id}`);
                      await identities.refetch();
                    })
                  }
                >
                  {t('account.revoke')}
                </button>
              </li>
            ))}
          </ul>
          {providers.data!.map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn-secondary mr-2"
              onClick={() =>
                void withReauth(async () => {
                  const r = await api<{ url: string }>('POST', `/auth/sso/${p.id}/start`, {
                    mode: 'link',
                  });
                  window.location.assign(r.url);
                })
              }
            >
              {t('sso.link', { provider: p.label })}
            </button>
          ))}
        </div>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </section>
  );
}

/** "Sign in with …" buttons on the login page. */
export function SsoButtons() {
  const { t } = useTranslation();
  const providers = useQuery({
    queryKey: ['sso-providers'],
    queryFn: () => api<Array<{ id: string; label: string }>>('GET', '/auth/sso/providers'),
  });
  if (!providers.data?.length) return null;
  return (
    <div className="space-y-2 border-t border-plum-200 pt-4 dark:border-plum-800">
      {providers.data.map((p) => (
        <button
          key={p.id}
          type="button"
          className="btn-secondary w-full"
          onClick={async () => {
            const r = await api<{ url: string }>('POST', `/auth/sso/${p.id}/start`, {
              mode: 'login',
            });
            window.location.assign(r.url);
          }}
        >
          {t('sso.signIn', { provider: p.label })}
        </button>
      ))}
      <p className="text-xs text-plum-500">{t('sso.hint')}</p>
    </div>
  );
}
