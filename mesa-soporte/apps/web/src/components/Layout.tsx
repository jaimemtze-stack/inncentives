import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, setCsrfToken } from '../api';
import { setLanguage } from '../i18n';
import { closeSocket, useRealtimeInvalidation } from '../lib/realtime';
import { Icon, type IconName } from './Icon';
import { CallToast, NotificationBell } from './Notifications';
import { useChatHeartbeat } from '../pages/Chat';
import { useArea, useMe } from '../session';

function NavLink(props: {
  to: string;
  icon: IconName;
  label: string;
  exact?: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      to={props.to}
      className="nav-item"
      activeProps={{ className: 'nav-item nav-item-active', 'aria-current': 'page' }}
      activeOptions={{ exact: props.exact ?? false }}
      onClick={props.onNavigate}
    >
      <Icon name={props.icon} />
      <span>{props.label}</span>
    </Link>
  );
}

function NavSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="nav-section">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function Layout() {
  const { t, i18n } = useTranslation();
  const area = useArea();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const authed = me.data?.state === 'authenticated';
  const agent = authed && area.data?.area === 'agent';
  const [menuOpen, setMenuOpen] = useState(false);
  const can = (p: string) => me.data?.permissions.includes(p) ?? false;
  const close = () => setMenuOpen(false);
  const appName = area.data?.area === 'agent' ? t('app.agent') : t('app.portal');
  useRealtimeInvalidation(authed);
  useChatHeartbeat(agent);

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

  const language = (
    <div className="flex items-center gap-2 px-3 text-plum-300">
      <Icon name="globe" className="h-4 w-4" />
      <label className="sr-only" htmlFor="lang">
        {t('common.language')}
      </label>
      <select
        id="lang"
        className="w-full rounded border border-plum-700 bg-plum-900 px-2 py-1 text-sm text-plum-100"
        value={i18n.language.startsWith('en') ? 'en' : 'es'}
        onChange={(e) => setLanguage(e.target.value as 'es' | 'en')}
      >
        <option value="es">Español</option>
        <option value="en">English</option>
      </select>
    </div>
  );

  // Signed out (login, MFA, invitation…): centred page on the plum backdrop.
  if (!authed) {
    return (
      <div className="flex min-h-screen flex-col bg-plum-900 px-4 py-8">
        <div className="mx-auto mb-8 flex w-full max-w-md items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-semibold text-white">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            <span>{appName}</span>
          </Link>
          <div className="w-36">{language}</div>
        </div>
        <main className="mx-auto w-full max-w-md text-plum-900 dark:text-slate-100">
          <Outlet />
        </main>
      </div>
    );
  }

  const sidebar = (
    <nav className="flex h-full flex-col overflow-y-auto px-3 py-4" aria-label={t('nav.main')}>
      <Link
        to="/"
        className="mb-2 flex items-center gap-2 px-3 font-semibold text-white"
        onClick={close}
      >
        <img src="/favicon.svg" alt="" className="h-8 w-8" />
        <span className="text-sm leading-tight">{appName}</span>
      </Link>
      <NavSection title={t('nav.sectionWork')}>
        <NavLink to="/" icon="tickets" label={t('nav.tickets')} exact onNavigate={close} />
        <NavLink to="/chat" icon="chat" label={t('nav.chat')} onNavigate={close} />
        {agent && <NavLink to="/telefono" icon="phone" label={t('nav.phone')} onNavigate={close} />}
        <NavLink to="/kb" icon="book" label={t('nav.kb')} onNavigate={close} />
      </NavSection>
      {agent && (
        <NavSection title={t('nav.sectionAnalyze')}>
          {can('reports.read') && (
            <NavLink to="/reportes" icon="chart" label={t('nav.reports')} onNavigate={close} />
          )}
          <NavLink to="/tiempo" icon="clock" label={t('nav.time')} onNavigate={close} />
        </NavSection>
      )}
      {(agent || can('admin.audit.read')) && (
        <NavSection title={t('nav.sectionManage')}>
          {agent && (
            <NavLink
              to="/admin"
              icon="building"
              label={t('admin.organizations')}
              exact
              onNavigate={close}
            />
          )}
          {agent && (
            <NavLink to="/configuracion" icon="cog" label={t('nav.config')} onNavigate={close} />
          )}
          {can('admin.audit.read') && (
            <NavLink
              to="/admin/bitacora"
              icon="shield"
              label={t('admin.audit')}
              onNavigate={close}
            />
          )}
        </NavSection>
      )}
      <div className="mt-auto space-y-2 border-t border-plum-700 pt-4">
        {agent && <NotificationBell variant="sidebar" />}
        <NavLink to="/cuenta" icon="user" label={t('common.account')} onNavigate={close} />
        {language}
        <button type="button" className="nav-item w-full" onClick={() => void logout()}>
          <Icon name="logout" />
          <span>{t('common.logout')}</span>
        </button>
        <p className="truncate px-3 text-xs text-plum-400">{me.data?.user.name}</p>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen md:pl-60">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-plum-900 px-4 py-2 md:hidden">
        <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-white">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span>{appName}</span>
        </Link>
        <button
          type="button"
          className="rounded p-2 text-plum-100 hover:bg-plum-700"
          aria-expanded={menuOpen}
          aria-controls="sidebar"
          aria-label={t('nav.menu')}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Icon name={menuOpen ? 'close' : 'menu'} />
        </button>
      </header>
      <aside
        id="sidebar"
        className={`fixed inset-y-0 left-0 z-40 w-60 bg-plum-900 md:block ${menuOpen ? 'block' : 'hidden'}`}
      >
        {sidebar}
      </aside>
      {menuOpen && (
        <div
          className="fixed inset-0 z-30 bg-plum-950/50 md:hidden"
          aria-hidden="true"
          onClick={close}
        />
      )}
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
        <Outlet />
        <p className="mt-8 text-center text-xs text-plum-500">{t('tickets.shortcuts')}</p>
      </main>
      {agent && <CallToast />}
    </div>
  );
}
