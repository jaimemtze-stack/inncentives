import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api, setCsrfToken } from '../api';
import { setLanguage } from '../i18n';
import { closeSocket, useRealtimeInvalidation } from '../lib/realtime';
import { CallToast, NotificationBell } from './Notifications';
import { useArea, useMe } from '../session';

export function Layout() {
  const { t, i18n } = useTranslation();
  const area = useArea();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const authed = me.data?.state === 'authenticated';
  const agent = authed && area.data?.area === 'agent';
  useRealtimeInvalidation(authed);

  // Keyboard shortcuts (ignored while typing): "/" search, "n" new ticket, "r" reply.
  useEffect(() => {
    if (!authed) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))
      )
        return;
      if (e.key === '/') {
        const q = document.getElementById('q');
        if (q) {
          e.preventDefault();
          q.focus();
        }
      } else if (e.key === 'n') {
        e.preventDefault();
        void navigate({ to: '/tickets/nuevo' });
      } else if (e.key === 'r') {
        const body = document.getElementById('abody');
        if (body) {
          e.preventDefault();
          body.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authed, navigate]);

  async function logout() {
    await api('POST', '/auth/logout').catch(() => undefined);
    setCsrfToken(null);
    closeSocket();
    await qc.invalidateQueries({ queryKey: ['me'] });
    await navigate({ to: '/entrar' });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span>{area.data?.area === 'agent' ? t('app.agent') : t('app.portal')}</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {authed && (
              <Link to="/" className="link">
                {t('nav.tickets')}
              </Link>
            )}
            {authed && (
              <Link to="/kb" className="link">
                {t('nav.kb')}
              </Link>
            )}
            {agent && (
              <Link to="/telefono" className="link">
                {t('nav.phone')}
              </Link>
            )}
            {agent && me.data?.permissions.includes('reports.read') && (
              <Link to="/reportes" className="link">
                {t('nav.reports')}
              </Link>
            )}
            {agent && (
              <Link to="/tiempo" className="link">
                {t('nav.time')}
              </Link>
            )}
            {agent && (
              <Link to="/admin" className="link">
                {t('admin.organizations')}
              </Link>
            )}
            {agent && (
              <Link to="/configuracion" className="link">
                {t('nav.config')}
              </Link>
            )}
            {agent && <NotificationBell />}
            {authed && me.data?.permissions.includes('admin.audit.read') && (
              <Link to="/admin/bitacora" className="link">
                {t('admin.audit')}
              </Link>
            )}
            {authed && (
              <Link to="/cuenta" className="link">
                {t('common.account')}
              </Link>
            )}
            <label className="sr-only" htmlFor="lang">
              {t('common.language')}
            </label>
            <select
              id="lang"
              className="rounded border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700"
              value={i18n.language.startsWith('en') ? 'en' : 'es'}
              onChange={(e) => setLanguage(e.target.value as 'es' | 'en')}
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
            {me.data && (
              <button type="button" className="btn-secondary" onClick={logout}>
                {t('common.logout')}
              </button>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
        {authed && (
          <p className="mt-6 text-center text-xs text-slate-500">{t('tickets.shortcuts')}</p>
        )}
      </main>
      {agent && <CallToast />}
    </div>
  );
}
