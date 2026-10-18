import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useErrorText } from './ui';

export function useAiEnabled(ticketId: string, staff: boolean) {
  return (
    useQuery({
      queryKey: ['ticket', ticketId, 'ai'],
      enabled: staff,
      queryFn: () => api<{ enabled: boolean }>('GET', `/tickets/${ticketId}/ai`),
      staleTime: 300_000,
    }).data?.enabled ?? false
  );
}

/**
 * AI suggestions (only when enabled for the customer). Everything is a
 * proposal: the agent reads it and decides; nothing is sent automatically.
 */
export function AiPanel(props: { ticketId: string; onSuggestion: (text: string) => void }) {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [classes, setClasses] = useState<{
    customFields: Record<string, string>;
    priorityId: string;
    priority: string;
    reason: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(name);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(errorText(err));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const base = `/tickets/${props.ticketId}/ai`;
  return (
    <div>
      <h3 className="font-semibold">{t('ai.title')}</h3>
      <p className="text-xs text-slate-600 dark:text-slate-300">{t('ai.notice')}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        <button
          type="button"
          className="btn-secondary px-2 py-1 text-xs"
          disabled={!!busy}
          onClick={() =>
            void run('summary', () => api<{ text: string }>('POST', `${base}/summary`)).then(
              (r) => r && setSummary(r.text),
            )
          }
        >
          {t('ai.summary')}
        </button>
        <button
          type="button"
          className="btn-secondary px-2 py-1 text-xs"
          disabled={!!busy}
          onClick={() =>
            void run('suggest', () =>
              api<{ text: string }>('POST', `${base}/suggest`, {
                locale: i18n.language.startsWith('en') ? 'en' : 'es-MX',
              }),
            ).then((r) => r && props.onSuggestion(r.text))
          }
        >
          {t('ai.suggest')}
        </button>
        <button
          type="button"
          className="btn-secondary px-2 py-1 text-xs"
          disabled={!!busy}
          onClick={() =>
            void run('classify', () =>
              api<NonNullable<typeof classes>>('POST', `${base}/classify`),
            ).then((r) => r && setClasses(r))
          }
        >
          {t('ai.classify')}
        </button>
      </div>
      {busy && (
        <p role="status" className="text-xs">
          {t('common.loading')}
        </p>
      )}
      {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
      {summary && <p className="mt-2 whitespace-pre-wrap text-xs">{summary}</p>}
      {classes && (
        <div className="mt-2 text-xs">
          <p>
            {classes.customFields.category} · {classes.customFields.inncentives_module} ·{' '}
            {classes.priority}
          </p>
          <p className="italic">{classes.reason}</p>
          <button
            type="button"
            className="btn-primary mt-1 px-2 py-1 text-xs"
            onClick={() =>
              void run('apply', () =>
                api('PATCH', `/tickets/${props.ticketId}`, {
                  priorityId: classes.priorityId,
                  customFields: classes.customFields,
                }),
              ).then(() => {
                setClasses(null);
                void qc.invalidateQueries({ queryKey: ['ticket', props.ticketId] });
              })
            }
          >
            {t('ai.apply')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Writing assistant inside the composer: replaces the draft only when the agent accepts. */
export function AiCompose(props: {
  ticketId: string;
  draft: string;
  onResult: (text: string) => void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [mode, setMode] = useState('improve');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ text: string }>('POST', `/tickets/${props.ticketId}/ai/compose`, {
        draft: props.draft,
        mode,
      });
      if (window.confirm(`${t('ai.replaceDraft')}\n\n${r.text}`)) props.onResult(r.text);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <label htmlFor="ai-mode" className="sr-only">
        {t('ai.compose')}
      </label>
      <select
        id="ai-mode"
        className="input mt-0 w-auto py-1 text-xs"
        value={mode}
        onChange={(e) => setMode(e.target.value)}
      >
        {['improve', 'formal', 'shorter', 'to_en', 'to_es'].map((m) => (
          <option key={m} value={m}>
            {t(`ai.modes.${m}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn-secondary px-2 py-1 text-xs"
        disabled={busy || !props.draft.trim()}
        onClick={() => void go()}
      >
        {t('ai.compose')}
      </button>
      {error && <span className="text-red-700 dark:text-red-300">{error}</span>}
    </div>
  );
}
