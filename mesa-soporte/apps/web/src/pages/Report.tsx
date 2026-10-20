import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ClipboardEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, uploadFile } from '../api';
import { AttachmentPicker, confirmSensitive } from '../components/Composer';
import { Alert, useErrorText } from '../components/ui';
import { clearReturnTo, clearWidgetToken, widgetToken } from '../lib/handoff';
import { formatDate, textToHtml } from '../lib/tickets';

interface WidgetContext {
  environment: { id: string; name: string; kind: string };
  module: string | null;
  url: string | null;
  version: string | null;
  reportedAt: string;
}

/** "Reportar un problema" opened from Inncentives with a signed context. */
export function ReportPage() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const [token] = useState(widgetToken);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [shots, setShots] = useState<Array<{ id: string; filename: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(clearReturnTo, []);

  const ctx = useQuery({
    queryKey: ['widget-context', token],
    enabled: !!token,
    retry: false,
    queryFn: () => api<WidgetContext>('POST', '/widget/context', { token }),
  });

  async function paste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    e.preventDefault();
    for (const img of images) {
      try {
        const name = `captura-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        const up = await uploadFile(new File([img], name, { type: img.type }));
        setShots((s) => [...s, up]);
      } catch (err) {
        setError(errorText(err));
      }
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!(await confirmSensitive(`${title}\n${body}`, t))) return;
    setBusy(true);
    setError(null);
    try {
      const attachmentIds = [...picked, ...shots.map((s) => s.id)];
      const tk = await api<{ id: string }>('POST', '/widget/tickets', {
        token,
        title,
        body: textToHtml(body),
        ...(attachmentIds.length ? { attachmentIds } : {}),
      });
      clearWidgetToken();
      await navigate({ to: '/tickets/$id', params: { id: tk.id } });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!token)
    return (
      <div className="card space-y-3">
        <h1 className="text-xl font-semibold">{t('widget.title')}</h1>
        <p>{t('widget.noContext')}</p>
        <Link to="/tickets/nuevo" className="btn-primary">
          {t('nav.newTicket')}
        </Link>
      </div>
    );

  return (
    <form className="card space-y-4" onSubmit={(e) => void submit(e)}>
      <h1 className="text-xl font-semibold">{t('widget.title')}</h1>
      {ctx.isError && <Alert>{errorText(ctx.error)}</Alert>}
      {ctx.data && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded border border-ink-200 p-3 text-sm dark:border-ink-700">
          <dt className="font-medium">{t('widget.environment')}</dt>
          <dd>{ctx.data.environment.name}</dd>
          <dt className="font-medium">{t('widget.module')}</dt>
          <dd>{ctx.data.module ?? '—'}</dd>
          <dt className="font-medium">{t('widget.version')}</dt>
          <dd>{ctx.data.version ?? '—'}</dd>
          <dt className="font-medium">URL</dt>
          <dd className="break-all">{ctx.data.url ?? '—'}</dd>
          <dt className="font-medium">{t('widget.time')}</dt>
          <dd>{formatDate(ctx.data.reportedAt, i18n.language)}</dd>
        </dl>
      )}
      <div>
        <label className="label" htmlFor="r-title">
          {t('tickets.title')}
        </label>
        <input
          id="r-title"
          className="input"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="r-body">
          {t('article.body')}
        </label>
        <textarea
          id="r-body"
          className="input min-h-40"
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={(e) => void paste(e)}
        />
        <p className="mt-1 text-xs text-ink-600 dark:text-ink-300">{t('widget.pasteHint')}</p>
        {shots.length > 0 && <p className="text-xs">{shots.map((s) => s.filename).join(', ')}</p>}
      </div>
      <AttachmentPicker onChange={setPicked} />
      {error && <Alert>{error}</Alert>}
      <button className="btn-primary" type="submit" disabled={busy || !ctx.data}>
        {t('widget.send')}
      </button>
    </form>
  );
}

interface EnvironmentInfo {
  id: string;
  name: string;
  kind: string;
  version: string;
  url: string;
  failedRuns: Array<{ id: string; process: string; startedAt: string; message: string | null }>;
  recentEvents: Array<{ id: string; at: string; action: string; user: string | null }>;
}

/** Agents' sidebar: the customer's Inncentives environments. */
export function InncentivesPanel({ ticketId }: { ticketId: string }) {
  const { t, i18n } = useTranslation();
  const q = useQuery({
    queryKey: ['ticket', ticketId, 'inncentives'],
    queryFn: () =>
      api<{ available: boolean; reason?: string; environments?: EnvironmentInfo[] }>(
        'GET',
        `/tickets/${ticketId}/inncentives`,
      ),
    staleTime: 60_000,
  });
  if (!q.data) return null;
  return (
    <div>
      <h3 className="font-semibold">Inncentives</h3>
      {!q.data.available ? (
        <p className="text-xs text-ink-600 dark:text-ink-300">
          {t(`inncentives.${q.data.reason ?? 'unavailable'}`)}
        </p>
      ) : (
        q.data.environments!.map((e) => (
          <details key={e.id} className="mt-1" open={e.kind === 'production'}>
            <summary className="cursor-pointer">
              {e.name} · {e.version}
            </summary>
            <a className="link text-xs" href={e.url} target="_blank" rel="noopener noreferrer">
              {e.url}
            </a>
            <h4 className="mt-1 text-xs font-semibold">{t('inncentives.failedRuns')}</h4>
            <ul className="text-xs">
              {e.failedRuns.length === 0 && <li>—</li>}
              {e.failedRuns.map((r) => (
                <li key={r.id}>
                  ✕ {r.process} · {formatDate(r.startedAt, i18n.language)}
                  {r.message ? ` · ${r.message}` : ''}
                </li>
              ))}
            </ul>
            <h4 className="mt-1 text-xs font-semibold">{t('inncentives.events')}</h4>
            <ul className="text-xs">
              {e.recentEvents.map((ev) => (
                <li key={ev.id}>
                  {formatDate(ev.at, i18n.language)} · {ev.action}
                  {ev.user ? ` · ${ev.user}` : ''}
                </li>
              ))}
            </ul>
          </details>
        ))
      )}
    </div>
  );
}
