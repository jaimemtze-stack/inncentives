import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Alert, useErrorText } from '../components/ui';
import { chatOrigin, clearReturnTo } from '../lib/handoff';
import { getSocket } from '../lib/realtime';
import { formatDate, htmlText, type Article } from '../lib/tickets';
import { useMe } from '../session';

const AVAILABLE_KEY = 'mesa.chat.available';

function readAvailable(): boolean {
  try {
    return window.localStorage.getItem(AVAILABLE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Refreshes chat queries when the server announces a chat change. */
function useChatEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const s = getSocket();
    const on = () => void qc.invalidateQueries({ queryKey: ['chat'] });
    s.on('chat', on);
    return () => {
      s.off('chat', on);
    };
  }, [qc]);
}

/**
 * Agents' "available for chat" heartbeat. Mounted by the layout so it keeps
 * running on every page; the server forgets an agent 90 s after the last beat.
 */
export function useChatHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const beat = () => {
      if (readAvailable())
        void api('POST', '/chat/availability', { available: true }).catch(() => undefined);
    };
    beat();
    const id = window.setInterval(beat, 60_000);
    return () => window.clearInterval(id);
  }, [enabled]);
}

interface Session {
  id: string;
  ticketId: string;
  state: 'waiting' | 'active' | 'ended';
}

function Conversation({ session, onEnded }: { session: Session; onEnded?: () => void }) {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const me = useMe();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const articles = useQuery({
    queryKey: ['ticket', session.ticketId, 'articles'],
    queryFn: () => api<Article[]>('GET', `/tickets/${session.ticketId}/articles`),
  });
  const messages = (articles.data ?? []).filter((a) => a.type === 'chat');
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [messages.length]);
  const mine = (a: Article) =>
    me.data?.user.role === 'CUSTOMER' ? a.sender === 'customer' : a.sender === 'agent';

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    try {
      await api('POST', `/chat/sessions/${session.id}/messages`, { body: text });
      setText('');
      await qc.invalidateQueries({ queryKey: ['ticket', session.ticketId] });
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function finish() {
    try {
      await api('POST', `/chat/sessions/${session.id}/end`);
      await qc.invalidateQueries({ queryKey: ['chat'] });
      onEnded?.();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="space-y-3">
      <ol
        className="max-h-[60vh] space-y-2 overflow-y-auto rounded border border-slate-200 p-3 dark:border-slate-700"
        aria-live="polite"
        aria-label={t('chat.messages')}
      >
        {messages.map((a) => (
          <li key={a.id} className={`flex ${mine(a) ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                mine(a)
                  ? 'bg-blue-700 text-white'
                  : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
              }`}
            >
              <p className="whitespace-pre-wrap">{htmlText(a.bodyHtml)}</p>
              <p className="mt-1 text-[11px] opacity-80">
                {a.authorName ?? ''} · {formatDate(a.createdAt, i18n.language)}
              </p>
            </div>
          </li>
        ))}
        <div ref={end} />
      </ol>
      {session.state === 'waiting' && (
        <p role="status" className="text-sm">
          {t('chat.waiting')}
        </p>
      )}
      {session.state !== 'ended' && (
        <form className="flex gap-2" onSubmit={(e) => void send(e)}>
          <label htmlFor="chat-input" className="sr-only">
            {t('chat.message')}
          </label>
          <input
            id="chat-input"
            className="input mt-0"
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
          />
          <button className="btn-primary" type="submit">
            {t('chat.send')}
          </button>
          <button className="btn-secondary" type="button" onClick={() => void finish()}>
            {t('chat.end')}
          </button>
        </form>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}

function CustomerChat() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ['chat', 'status'],
    queryFn: () =>
      api<{ enabled: boolean; available: boolean; session: Session | null }>('GET', '/chat/status'),
    refetchInterval: 30_000,
  });

  async function start(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('POST', '/chat/sessions', { message: first, origin: chatOrigin() });
      setFirst('');
      await qc.invalidateQueries({ queryKey: ['chat'] });
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!status.data) return null;
  if (status.data.session) return <Conversation session={status.data.session} />;
  if (!status.data.enabled || !status.data.available)
    return (
      <div className="space-y-3">
        <p>{t('chat.unavailable')}</p>
        <Link to="/tickets/nuevo" className="btn-primary">
          {t('nav.newTicket')}
        </Link>
      </div>
    );
  return (
    <form className="space-y-3" onSubmit={(e) => void start(e)}>
      <label htmlFor="chat-first" className="label">
        {t('chat.firstMessage')}
      </label>
      <textarea
        id="chat-first"
        className="input min-h-24"
        required
        maxLength={4000}
        value={first}
        onChange={(e) => setFirst(e.target.value)}
      />
      {error && <Alert>{error}</Alert>}
      <button className="btn-primary" type="submit">
        {t('chat.start')}
      </button>
    </form>
  );
}

interface QueueItem extends Session {
  number?: string;
  title?: string;
  customer: string | null;
  startedAt: string;
  origin: string;
}

function AgentChat() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const [available, setAvailable] = useState(readAvailable);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queue = useQuery({
    queryKey: ['chat', 'queue'],
    queryFn: () => api<QueueItem[]>('GET', '/chat/queue'),
    refetchInterval: 30_000,
    retry: false,
  });

  async function toggle(next: boolean) {
    setError(null);
    setAvailable(next);
    try {
      await api('POST', '/chat/availability', { available: next });
      try {
        window.localStorage.setItem(AVAILABLE_KEY, next ? '1' : '0');
      } catch {
        // Without storage the heartbeat stops with this tab; the server expires it.
      }
    } catch (err) {
      setAvailable(!next);
      setError(errorText(err));
    }
  }

  async function accept(id: string) {
    setError(null);
    try {
      await api('POST', `/chat/sessions/${id}/accept`);
      setSelected(id);
      await qc.invalidateQueries({ queryKey: ['chat'] });
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (queue.isError) return <Alert>{errorText(queue.error)}</Alert>;
  const items = queue.data ?? [];
  const current = items.find((i) => i.id === selected && i.state === 'active');
  return (
    <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
      <div className="space-y-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={available}
            onChange={(e) => void toggle(e.target.checked)}
          />
          {t('chat.available')}
        </label>
        {error && <Alert>{error}</Alert>}
        <ul className="space-y-2" aria-label={t('chat.queue')}>
          {items.length === 0 && <li className="text-sm">{t('chat.empty')}</li>}
          {items.map((i) => (
            <li
              key={i.id}
              className="rounded border border-slate-200 p-2 text-sm dark:border-slate-700"
            >
              <p className="font-medium">{i.customer ?? '—'}</p>
              <p className="truncate">{i.title}</p>
              <p className="text-xs">
                {t(`chat.states.${i.state}`)} · {formatDate(i.startedAt, i18n.language)}
                {i.origin === 'widget' ? ' · Inncentives' : ''}
              </p>
              {i.state === 'waiting' ? (
                <button
                  type="button"
                  className="btn-primary mt-1 px-2 py-1 text-xs"
                  onClick={() => void accept(i.id)}
                >
                  {t('chat.accept')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary mt-1 px-2 py-1 text-xs"
                  onClick={() => setSelected(i.id)}
                >
                  {t('chat.open')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div>
        {current ? (
          <>
            <Link to="/tickets/$id" params={{ id: current.ticketId }} className="link text-sm">
              #{current.number}
            </Link>
            <Conversation session={current} onEnded={() => setSelected(null)} />
          </>
        ) : (
          <p className="text-sm">{t('chat.select')}</p>
        )}
      </div>
    </div>
  );
}

export function ChatPage() {
  const { t } = useTranslation();
  const me = useMe();
  useChatEvents();
  useEffect(clearReturnTo, []);
  return (
    <section className="card space-y-4">
      <h1 className="text-xl font-semibold">{t('chat.title')}</h1>
      {me.data?.area === 'agent' ? <AgentChat /> : <CustomerChat />}
    </section>
  );
}
