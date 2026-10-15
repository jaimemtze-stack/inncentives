import { Outlet, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui';
import { api, currentArea } from '../lib/api';

export function Layout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const area = currentArea();
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip
      </a>
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="font-semibold">
          {t('app.name')}{' '}
          <span className="text-sm font-normal text-slate-500">
            · {area === 'agent' ? t('app.agentArea') : t('app.portal')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="lang">
            {t('app.language')}
          </label>
          <select
            id="lang"
            className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-700"
            value={i18n.language}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
          >
            <option value="es-MX">Español (México)</option>
            <option value="en">English</option>
          </select>
          <Button
            variant="ghost"
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
              qc.clear();
              await navigate({ to: '/login' });
            }}
          >
            {t('auth.signOut')}
          </Button>
        </div>
      </header>
      <main id="main" className="px-4">
        <Outlet />
      </main>
      {area === 'portal' ? (
        <footer className="p-4 text-center text-xs text-slate-500">
          <a href="/privacy" className="underline">
            {t('privacy')}
          </a>
        </footer>
      ) : null}
    </div>
  );
}
