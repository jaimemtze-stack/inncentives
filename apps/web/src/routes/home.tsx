import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button } from '../components/ui';
import { api, type Me } from '../lib/api';

interface SessionItem {
  id: string;
  current: boolean;
  area: string;
  lastSeenAt: string;
  userAgent: string | null;
}

export function HomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<{ items: SessionItem[] }>('/auth/sessions'),
    enabled: !!me.data && !me.data.mfaSetupRequired,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });

  useEffect(() => {
    if (me.isError) void navigate({ to: '/login' });
    if (me.data?.mfaSetupRequired) void navigate({ to: '/mfa-setup' });
  }, [me.isError, me.data, navigate]);

  if (!me.data) return null;
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">{t('home.welcome', { name: me.data.firstname })}</h1>
      {me.data.area === 'portal' && !me.data.mfaEnabled ? (
        <Alert kind="info">{t('auth.mfaRecommended')}</Alert>
      ) : null}
      <p className="text-slate-600 dark:text-slate-300">
        {me.data.area === 'agent' ? t('home.agentPlaceholder') : t('home.portalPlaceholder')}
      </p>
      <section
        aria-labelledby="sessions-title"
        className="rounded-lg border border-slate-200 p-4 dark:border-slate-800"
      >
        <h2 id="sessions-title" className="mb-3 font-medium">
          {t('home.sessions')}
        </h2>
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {sessions.data?.items.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span className="truncate">
                {s.userAgent ?? '—'} · {fmt.format(new Date(s.lastSeenAt))}
              </span>
              {s.current ? (
                <span className="text-xs text-slate-500">{t('home.current')}</span>
              ) : (
                <Button variant="ghost" onClick={() => revoke.mutate(s.id)}>
                  {t('home.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
