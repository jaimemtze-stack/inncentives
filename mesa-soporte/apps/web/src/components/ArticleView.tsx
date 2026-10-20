import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { formatDate, type Article } from '../lib/tickets';
import { useErrorText } from './ui';

async function download(id: string) {
  const { url } = await api<{ url: string }>('GET', `/attachments/${id}`);
  // Signed storage URL: served as an attachment from the storage host, without cookies.
  window.location.assign(url);
}

export type ArticleAction = 'reply' | 'replyAll' | 'forward' | 'quote' | 'split';

export function ArticleView(props: {
  article: Article;
  staff: boolean;
  onChanged: () => void;
  onAction?: (action: ArticleAction, article: Article) => void;
}) {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const a = props.article;
  const body = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const hasRemote = a.bodyHtml.includes('data-remote-src');

  function showImages() {
    body.current?.querySelectorAll<HTMLImageElement>('img[data-remote-src]').forEach((img) => {
      const src = img.dataset.remoteSrc ?? '';
      if (/^https:\/\//i.test(src)) img.src = src;
    });
  }

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      props.onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const tone = a.internal
    ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950'
    : a.sender === 'customer'
      ? 'border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-850'
      : 'border-brand-200 bg-brand-50 dark:border-brand-900 dark:bg-brand-950';

  return (
    <article className={`rounded-lg border p-4 ${tone}`} data-testid="article">
      <header className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-600 dark:text-ink-400">
        <strong className="text-sm text-ink-900 dark:text-slate-100">
          {a.authorName ?? a.from ?? t('article.types.system')}
        </strong>
        <span>{t(`article.types.${a.type}`)}</span>
        {a.internal && (
          <span className="rounded bg-amber-200 px-1 text-amber-900">{t('article.internal')}</span>
        )}
        {a.callDirection && (
          <span>
            {t(`article.${a.callDirection}`)} {a.callNumber}
          </span>
        )}
        {a.deliveryStatus && <span>· {t(`article.delivery.${a.deliveryStatus}`)}</span>}
        {a.sensitiveData && props.staff && (
          <span className="font-semibold text-red-700">⚠ {t('tickets.sensitive')}</span>
        )}
        <time className="ml-auto">{formatDate(a.createdAt, i18n.language)}</time>
      </header>
      {a.subject && a.type === 'email' && <p className="mb-1 text-sm font-medium">{a.subject}</p>}
      {/* Server-side sanitised HTML (allow-list); the page CSP forbids scripts. */}
      <div
        ref={body}
        className="prose-sm max-w-none break-words"
        // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- sanitised by the API allow-list
        dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {hasRemote && (
          <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={showImages}>
            {t('article.showImages')}
          </button>
        )}
        {props.staff && props.onAction && a.type !== 'system' && (
          <>
            {a.type === 'email' && (
              <>
                <button
                  type="button"
                  className="btn-secondary px-2 py-1 text-xs"
                  onClick={() => props.onAction!('reply', a)}
                >
                  {t('article.reply')}
                </button>
                <button
                  type="button"
                  className="btn-secondary px-2 py-1 text-xs"
                  onClick={() => props.onAction!('replyAll', a)}
                >
                  {t('article.replyAll')}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              onClick={() => props.onAction!('forward', a)}
            >
              {t('article.forward')}
            </button>
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              onClick={() => props.onAction!('quote', a)}
            >
              {t('article.quote')}
            </button>
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              onClick={() => props.onAction!('split', a)}
            >
              {t('article.split')}
            </button>
          </>
        )}
        {props.staff && a.sensitiveData && (
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-xs"
            onClick={() => void run(() => api('POST', `/articles/${a.id}/redact`))}
          >
            {t('article.redact')}
          </button>
        )}
      </div>
      {a.attachments.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {a.attachments.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2">
              <span>📎 {f.filename}</span>
              <span className="text-xs text-ink-500">{Math.ceil(f.size / 1024)} KB</span>
              {f.scanStatus === 'clean' || f.scanStatus === 'skipped' ? (
                <button
                  type="button"
                  className="link text-xs"
                  onClick={() => void run(() => download(f.id))}
                >
                  {t('article.download')}
                </button>
              ) : (
                <span className="text-xs">{t(`article.scan.${f.scanStatus}`)}</span>
              )}
              {props.staff && (
                <button
                  type="button"
                  className="text-xs text-red-700 underline"
                  onClick={() => void run(() => api('DELETE', `/attachments/${f.id}`))}
                >
                  {t('article.deleteAttachment')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </article>
  );
}
