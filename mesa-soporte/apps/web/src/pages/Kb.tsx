import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Alert, useErrorText } from '../components/ui';
import { formatDate, textToHtml } from '../lib/tickets';
import { useMe } from '../session';

interface Category {
  id: string;
  parentId: string | null;
  names: Record<string, string>;
  answers: number;
}

interface AnswerSummary {
  id: string;
  categoryId: string;
  translations: Array<{ locale: string; title: string }>;
  state?: string;
  visibility?: string;
  publishAt?: string | null;
}

interface AnswerDetail extends AnswerSummary {
  translations: Array<{
    locale: string;
    title: string;
    bodyHtml: string;
    keywords: string[];
    version: number;
    updatedAt: string;
  }>;
}

export function kbLocale(lng: string): 'es-MX' | 'en' {
  return lng.startsWith('en') ? 'en' : 'es-MX';
}

function pick<T extends { locale: string }>(list: T[], locale: string): T | undefined {
  return list.find((x) => x.locale === locale) ?? list[0];
}

export function useKbSearch(q: string, limit = 20) {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: ['kb-search', q, limit],
    enabled: q.trim().length >= 3,
    queryFn: () =>
      api<Array<{ id: string; title: string; snippet: string; locale: string }>>(
        'GET',
        `/kb/search?q=${encodeURIComponent(q.trim())}&limit=${limit}&locale=${kbLocale(i18n.language)}`,
      ),
  });
}

/** Knowledge base browser for customers and agents. */
export function KbPage() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const editor = me.data?.permissions.includes('kb.edit') ?? false;
  const locale = kbLocale(i18n.language);
  const [category, setCategory] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const cats = useQuery({
    queryKey: ['kb-categories'],
    queryFn: () => api<Category[]>('GET', '/kb/categories'),
  });
  const list = useQuery({
    queryKey: ['kb-answers', category],
    queryFn: () =>
      api<AnswerSummary[]>('GET', `/kb/answers${category ? `?categoryId=${category}` : ''}`),
  });
  const found = useKbSearch(q);
  const name = (c: Category) => c.names[locale] ?? Object.values(c.names)[0];

  return (
    <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
      <aside className="space-y-1 text-sm" aria-label={t('kb.categories')}>
        {editor && (
          <Link to="/kb/nueva" className="btn-primary mb-3 w-full">
            {t('kb.newAnswer')}
          </Link>
        )}
        <button
          type="button"
          className={`block w-full rounded px-3 py-1.5 text-left ${!category ? 'font-semibold' : ''}`}
          onClick={() => setCategory(null)}
        >
          {t('kb.all')}
        </button>
        {cats.data
          ?.filter((c) => editor || c.answers > 0 || cats.data.some((x) => x.parentId === c.id))
          .map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`flex w-full justify-between rounded px-3 py-1.5 text-left ${c.parentId ? 'pl-6' : ''} ${category === c.id ? 'bg-blue-50 font-semibold dark:bg-blue-950' : ''}`}
            >
              <span>{name(c)}</span>
              <span className="text-xs text-slate-500">{c.answers}</span>
            </button>
          ))}
      </aside>
      <section className="card space-y-4">
        <h1 className="text-xl font-semibold">{t('kb.title')}</h1>
        <label htmlFor="kbq" className="sr-only">
          {t('kb.search')}
        </label>
        <input
          id="kbq"
          className="input"
          placeholder={t('kb.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={200}
        />
        {q.trim().length >= 3 ? (
          <ul className="space-y-3">
            {found.data?.map((r) => (
              <li key={`${r.id}-${r.locale}`}>
                <Link to="/kb/$id" params={{ id: r.id }} className="link font-medium">
                  {r.title}
                </Link>
                <p className="text-sm text-slate-600 dark:text-slate-400">{r.snippet}…</p>
              </li>
            ))}
            {found.data?.length === 0 && <p className="text-sm">{t('kb.noResults')}</p>}
          </ul>
        ) : (
          <ul className="space-y-2">
            {list.data?.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <Link to="/kb/$id" params={{ id: a.id }} className="link">
                  {pick(a.translations, locale)?.title}
                </Link>
                {a.state && a.state !== 'published' && (
                  <span className="rounded bg-slate-200 px-1 text-xs dark:bg-slate-700">
                    {t(`kb.states.${a.state}`)}
                  </span>
                )}
                {a.visibility === 'internal' && (
                  <span className="rounded bg-amber-200 px-1 text-xs text-amber-900">
                    {t('kb.internal')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One answer; editors also edit translations, publication and see versions. */
export function KbAnswerPage() {
  const { id } = useParams({ from: '/kb/$id' });
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const me = useMe();
  const editor = me.data?.permissions.includes('kb.edit') ?? false;
  const answer = useQuery({
    queryKey: ['kb-answer', id],
    queryFn: () => api<AnswerDetail>('GET', `/kb/answers/${id}`),
  });
  const [locale, setLocale] = useState(kbLocale(i18n.language));
  const [edit, setEdit] = useState<{ title: string; body: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const versions = useQuery({
    queryKey: ['kb-versions', id, locale],
    enabled: editor,
    queryFn: () =>
      api<Array<{ version: number; title: string; createdAt: string }>>(
        'GET',
        `/kb/answers/${id}/translations/${locale}/versions`,
      ).catch(() => []),
  });
  if (!answer.data) return <p>{t('common.loading')}</p>;
  const a = answer.data;
  const tr = a.translations.find((x) => x.locale === locale);
  const shown = tr ?? pick(a.translations, locale);

  async function run(fn: () => Promise<unknown>) {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'success', text: t('tickets.saved') });
      await qc.invalidateQueries({ queryKey: ['kb-answer', id] });
      await qc.invalidateQueries({ queryKey: ['kb-versions', id] });
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    void run(() =>
      api('PUT', `/kb/answers/${id}/translations/${locale}`, {
        title: edit.title,
        body: textToHtml(edit.body),
      }),
    ).then(() => setEdit(null));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <article className="card space-y-3">
        <div className="flex gap-2 text-xs">
          {(['es-MX', 'en'] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={`rounded px-2 py-1 ${l === locale ? 'bg-blue-100 font-semibold dark:bg-blue-900' : ''}`}
              onClick={() => setLocale(l)}
            >
              {l === 'en' ? 'English' : 'Español'}
            </button>
          ))}
        </div>
        {edit ? (
          <form onSubmit={save} className="space-y-2">
            <label htmlFor="kbt" className="label">
              {t('tickets.title')}
            </label>
            <input
              id="kbt"
              className="input"
              value={edit.title}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              required
              maxLength={250}
            />
            <label htmlFor="kbb" className="label">
              {t('article.body')}
            </label>
            <textarea
              id="kbb"
              className="input min-h-64"
              value={edit.body}
              onChange={(e) => setEdit({ ...edit, body: e.target.value })}
              required
            />
            <button type="submit" className="btn-primary">
              {t('common.save')}
            </button>
          </form>
        ) : shown ? (
          <>
            <h1 className="text-2xl font-semibold">{shown.title}</h1>
            {/* nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- sanitised by the API allow-list */}
            <div
              className="prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: shown.bodyHtml }}
            />
            {!tr && <p className="text-xs text-slate-500">{t('kb.notTranslated')}</p>}
          </>
        ) : null}
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      </article>
      {editor && (
        <aside className="card space-y-3 text-sm">
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={() => {
              const text = tr
                ? (new DOMParser().parseFromString(tr.bodyHtml, 'text/html').body.textContent ?? '')
                : '';
              setEdit({ title: tr?.title ?? '', body: text });
            }}
          >
            {tr ? t('kb.editTranslation') : t('kb.addTranslation')}
          </button>
          <p>
            {t('kb.state')}: <strong>{t(`kb.states.${a.state}`)}</strong>
          </p>
          <div className="flex flex-wrap gap-1">
            {a.state !== 'published' && (
              <button
                type="button"
                className="btn-primary px-2 py-1"
                onClick={() =>
                  void run(() => api('PATCH', `/kb/answers/${id}`, { state: 'published' }))
                }
              >
                {t('kb.publish')}
              </button>
            )}
            {a.state === 'published' && (
              <button
                type="button"
                className="btn-secondary px-2 py-1"
                onClick={() =>
                  void run(() => api('PATCH', `/kb/answers/${id}`, { state: 'archived' }))
                }
              >
                {t('kb.archive')}
              </button>
            )}
            <button
              type="button"
              className="btn-secondary px-2 py-1"
              onClick={() =>
                void run(() =>
                  api('PATCH', `/kb/answers/${id}`, {
                    visibility: a.visibility === 'internal' ? 'customer' : 'internal',
                  }),
                )
              }
            >
              {a.visibility === 'internal' ? t('kb.makeCustomer') : t('kb.makeInternal')}
            </button>
          </div>
          <div>
            <label htmlFor="kbpa" className="label">
              {t('kb.publishAt')}
            </label>
            <input
              id="kbpa"
              type="datetime-local"
              className="input"
              defaultValue={a.publishAt ? a.publishAt.slice(0, 16) : ''}
              onBlur={(e) =>
                void run(() =>
                  api('PATCH', `/kb/answers/${id}`, {
                    publishAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                  }),
                )
              }
            />
          </div>
          <div>
            <h2 className="font-semibold">{t('kb.versions')}</h2>
            <ul className="text-xs">
              {versions.data?.map((v) => (
                <li key={v.version}>
                  v{v.version} · {v.title} · {formatDate(v.createdAt, i18n.language)}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </div>
  );
}

export function KbNewPage() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const cats = useQuery({
    queryKey: ['kb-categories'],
    queryFn: () => api<Category[]>('GET', '/kb/categories'),
  });
  const [form, setForm] = useState({ categoryId: '', visibility: 'customer', title: '', body: '' });
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const locale = kbLocale(i18n.language);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const a = await api<{ id: string }>('POST', '/kb/answers', {
        categoryId: form.categoryId,
        visibility: form.visibility,
        locale,
        translation: { title: form.title, body: textToHtml(form.body) },
      });
      setCreated(a.id);
    } catch (err) {
      setError(errorText(err));
    }
  }
  if (created) {
    return (
      <Alert kind="success">
        <Link to="/kb/$id" params={{ id: created }} className="link">
          {t('kb.created')}
        </Link>
      </Alert>
    );
  }
  return (
    <form onSubmit={submit} className="card mx-auto max-w-3xl space-y-3">
      <h1 className="text-xl font-semibold">{t('kb.newAnswer')}</h1>
      <label htmlFor="kbcat" className="label">
        {t('kb.category')}
      </label>
      <select
        id="kbcat"
        className="input"
        required
        value={form.categoryId}
        onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
      >
        <option value="">—</option>
        {cats.data?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.names[locale] ?? Object.values(c.names)[0]}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.visibility === 'internal'}
          onChange={(e) =>
            setForm({ ...form, visibility: e.target.checked ? 'internal' : 'customer' })
          }
        />
        {t('kb.internalOnly')}
      </label>
      <label htmlFor="kbnt" className="label">
        {t('tickets.title')}
      </label>
      <input
        id="kbnt"
        className="input"
        required
        maxLength={250}
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
      />
      <label htmlFor="kbnb" className="label">
        {t('article.body')}
      </label>
      <textarea
        id="kbnb"
        className="input min-h-64"
        required
        value={form.body}
        onChange={(e) => setForm({ ...form, body: e.target.value })}
      />
      {error && <Alert>{error}</Alert>}
      <button type="submit" className="btn-primary">
        {t('kb.saveDraft')}
      </button>
    </form>
  );
}
