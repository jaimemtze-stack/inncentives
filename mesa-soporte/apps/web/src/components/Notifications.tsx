import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { getSocket } from '../lib/realtime';

interface Notif {
  id: string;
  type: string;
  title: string;
  readAt: string | null;
  ticket: { id: string; number: string } | null;
}

export function NotificationBell() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ unread: number; items: Notif[] }>('GET', '/me/notifications?limit=20'),
    refetchInterval: 120_000,
  });
  async function markAll() {
    await api('POST', '/me/notifications/read', { all: true });
    await qc.invalidateQueries({ queryKey: ['notifications'] });
  }
  return (
    <div className="relative">
      <button
        type="button"
        className="btn-secondary px-3"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        aria-label={t('nav.notifications')}
      >
        🔔
        {list.data?.unread ? (
          <span className="ml-1 rounded-full bg-red-700 px-1.5 text-xs text-white">
            {list.data.unread}
          </span>
        ) : null}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {!list.data?.items.length && <p className="text-sm">{t('notif.empty')}</p>}
          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {list.data?.items.map((n) => (
              <li key={n.id} className={n.readAt ? 'opacity-60' : 'font-medium'}>
                {n.ticket ? (
                  <Link
                    to="/tickets/$id"
                    params={{ id: n.ticket.id }}
                    className="link"
                    onClick={() => setOpen(false)}
                  >
                    {n.title}
                  </Link>
                ) : (
                  n.title
                )}
              </li>
            ))}
          </ul>
          {(list.data?.unread ?? 0) > 0 && (
            <button type="button" className="link mt-2 text-xs" onClick={() => void markAll()}>
              {t('notif.markAll')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** CTI pop-up: incoming calls announced by the telephony webhook. */
export function CallToast() {
  const { t } = useTranslation();
  const [call, setCall] = useState<{ callId: string; number: string; state: string } | null>(null);
  useEffect(() => {
    const s = getSocket();
    const onCall = (c: { callId: string; number: string; state: string; direction: string }) => {
      if (c.direction === 'in' && c.state === 'ringing') setCall(c);
      else if (c.state === 'ended') setCall((cur) => (cur?.callId === c.callId ? null : cur));
    };
    s.on('call', onCall);
    return () => {
      s.off('call', onCall);
    };
  }, []);
  if (!call) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-30 rounded-lg bg-blue-800 p-4 text-white shadow-lg"
    >
      <p className="font-semibold">{t('phone.incoming', { number: call.number })}</p>
      <a className="underline" href={`/telefono?number=${encodeURIComponent(call.number)}`}>
        {t('phone.lookup')}
      </a>
      <button type="button" className="ml-3 text-sm" onClick={() => setCall(null)}>
        ×
      </button>
    </div>
  );
}
