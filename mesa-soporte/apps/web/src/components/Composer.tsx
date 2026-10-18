import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api, uploadFile } from '../api';
import { textToHtml, useFormMeta, type Attribute, type Ref } from '../lib/tickets';
import { useKbSearch } from '../pages/Kb';
import { Alert, useErrorText } from './ui';

/** Expands "::keyword " into the matching text module. */
function expandTextModules(
  text: string,
  modules: Array<{ keyword: string; content: string }>,
): string {
  return text.replace(/::([\w-]{1,40})(\s)$/, (m, kw: string, space: string) => {
    const mod = modules.find((x) => x.keyword === kw);
    return mod ? `${mod.content}${space}` : m;
  });
}

/** Asks the API whether the text looks like payroll/personal data; true = go ahead. */
export async function confirmSensitive(text: string, t: TFunction): Promise<boolean> {
  try {
    const r = await api<{ findings: Array<{ kind: string }> }>('POST', '/sensitive-check', {
      text,
    });
    if (!r.findings.length) return true;
    return window.confirm(
      t('article.sensitiveWarning', {
        kinds: r.findings.map((f) => f.kind.toUpperCase()).join(', '),
      }),
    );
  } catch {
    return true;
  }
}

export function AttachmentPicker({ onChange }: { onChange: (ids: string[]) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [files, setFiles] = useState<Array<{ id: string; filename: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  async function pick(list: FileList | null) {
    if (!list) return;
    setError(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      try {
        next.push(await uploadFile(f));
      } catch (err) {
        setError(`${f.name}: ${errorText(err)}`);
      }
    }
    setFiles(next);
    onChange(next.map((f) => f.id));
  }
  return (
    <div className="space-y-1">
      <label className="label" htmlFor="attach">
        {t('article.attach')}
      </label>
      <input
        id="attach"
        type="file"
        multiple
        onChange={(e) => void pick(e.target.files)}
        className="text-sm"
      />
      {files.length > 0 && (
        <p className="text-xs text-slate-600">{files.map((f) => f.filename).join(', ')}</p>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}

export function CustomFieldInputs(props: {
  attributes: Attribute[];
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  customer: boolean;
  disabled?: boolean;
}) {
  const { i18n } = useTranslation();
  const en = i18n.language.startsWith('en');
  const set = (name: string, v: unknown) =>
    props.onChange({ ...props.values, [name]: v === '' ? null : v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {props.attributes
        .filter((a) => !props.customer || a.editableByCustomer)
        .map((a) => {
          const id = `cf-${a.name}`;
          const label = `${(en && a.labelEn) || a.label}${a.required ? ' *' : ''}`;
          const v = props.values[a.name];
          return (
            <div key={a.name}>
              <label htmlFor={id} className="label">
                {label}
              </label>
              {a.dataType === 'select' ? (
                <select
                  id={id}
                  className="input"
                  value={String(v ?? '')}
                  disabled={props.disabled}
                  onChange={(e) => set(a.name, e.target.value)}
                >
                  <option value="">—</option>
                  {a.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {(en && o.labelEn) || o.label}
                    </option>
                  ))}
                </select>
              ) : a.dataType === 'boolean' ? (
                <input
                  id={id}
                  type="checkbox"
                  checked={v === true}
                  disabled={props.disabled}
                  onChange={(e) => set(a.name, e.target.checked)}
                />
              ) : a.dataType === 'textarea' ? (
                <textarea
                  id={id}
                  className="input"
                  value={String(v ?? '')}
                  disabled={props.disabled}
                  maxLength={2000}
                  onChange={(e) => set(a.name, e.target.value)}
                />
              ) : (
                <input
                  id={id}
                  className="input"
                  type={
                    a.dataType === 'integer' ? 'number' : a.dataType === 'date' ? 'date' : 'text'
                  }
                  value={String(v ?? '')}
                  disabled={props.disabled}
                  maxLength={500}
                  onChange={(e) =>
                    set(
                      a.name,
                      a.dataType === 'integer' && e.target.value
                        ? Number(e.target.value)
                        : e.target.value,
                    )
                  }
                />
              )}
            </div>
          );
        })}
    </div>
  );
}

type ArticleKind = 'email' | 'note' | 'phone' | 'whatsapp' | 'sms';

export interface ComposerPreset {
  key: number;
  type: ArticleKind;
  to?: string;
  cc?: string;
  body?: string;
}

function readLocalDraft(id: string): string {
  try {
    return window.localStorage.getItem(`draft:${id}`) ?? '';
  } catch {
    return '';
  }
}

function writeLocalDraft(id: string, body: string): void {
  try {
    if (body) window.localStorage.setItem(`draft:${id}`, body);
    else window.localStorage.removeItem(`draft:${id}`);
  } catch {
    // Storage unavailable (private mode): drafts simply are not kept.
  }
}

/** Agents search the knowledge base and insert a link or the answer text. */
function KbInsert({ onInsert }: { onInsert: (text: string) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const found = useKbSearch(q, 5);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-blue-700 dark:text-blue-400">
        {t('kb.insert')}
      </summary>
      <input
        aria-label={t('kb.search')}
        className="input"
        placeholder={t('kb.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="mt-1 space-y-1">
        {found.data?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2">
            <span>{r.title}</span>
            <button
              type="button"
              className="link text-xs"
              onClick={() =>
                onInsert(`${r.title}: ${window.location.origin.replace('agentes.', '')}/kb/${r.id}`)
              }
            >
              {t('kb.insertLink')}
            </button>
            <button
              type="button"
              className="link text-xs"
              onClick={async () => {
                const a = await api<{
                  translations: Array<{ locale: string; title: string; bodyHtml: string }>;
                }>('GET', `/kb/answers/${r.id}`);
                const tr = a.translations.find((x) => x.locale === r.locale) ?? a.translations[0];
                if (tr)
                  onInsert(
                    new DOMParser().parseFromString(tr.bodyHtml, 'text/html').body.textContent ??
                      '',
                  );
              }}
            >
              {t('kb.insertContent')}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Reply box for an existing ticket (agents: e-mail/note/phone; customers: portal message). */
export function Composer(props: {
  ticketId: string;
  staff: boolean;
  onSent: () => void;
  onTyping?: (t: boolean) => void;
  preset?: ComposerPreset | null;
  /** Agents of the ticket group, for @mentions. */
  agents?: Ref[];
  /** Changes when someone else updates the ticket while this box has text. */
  ticketUpdatedAt?: string;
  /** Messaging channels the customer wrote on (reply options). */
  messaging?: Array<'whatsapp' | 'sms'>;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const meta = useFormMeta();
  const [type, setType] = useState<ArticleKind>('note');
  const messagingReply = type === 'whatsapp' || type === 'sms';
  const [internal, setInternal] = useState(true);
  const [body, setBody] = useState(() => readLocalDraft(props.ticketId));
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [callNumber, setCallNumber] = useState('');
  const [minutes, setMinutes] = useState('');
  const [activityTypeId, setActivityTypeId] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  const startedAt = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!props.preset) return;
    setType(props.preset.type);
    setInternal(props.preset.type === 'note');
    setTo(props.preset.to ?? '');
    setCc(props.preset.cc ?? '');
    if (props.preset.body) setBody((b) => `${props.preset!.body}${b ? `\n\n${b}` : ''}`);
    document.getElementById('abody')?.focus();
  }, [props.preset]);

  useEffect(() => writeLocalDraft(props.ticketId, body), [props.ticketId, body]);

  // Collision warning: the ticket changed after this reply was started.
  useEffect(() => {
    if (!body) startedAt.current = props.ticketUpdatedAt;
    else if (
      startedAt.current &&
      props.ticketUpdatedAt &&
      props.ticketUpdatedAt !== startedAt.current
    ) {
      setInfo(t('article.changedWhileWriting'));
    }
  }, [props.ticketUpdatedAt, body, t]);

  async function saveShared() {
    try {
      await api('PUT', `/tickets/${props.ticketId}/draft`, { body, meta: { type, to } });
      setInfo(t('article.sharedSaved'));
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function loadShared() {
    try {
      const d = await api<{ body: string } | null>('GET', `/tickets/${props.ticketId}/draft`);
      if (d) setBody(d.body);
      else setInfo(t('article.noShared'));
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!props.staff && !(await confirmSensitive(body, t))) return;
    setBusy(true);
    const list = (v: string) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    try {
      const payload: Record<string, unknown> = props.staff
        ? {
            type,
            internal: type === 'note' ? internal : false,
            body: textToHtml(body),
            ...(type === 'email' && to.trim() ? { to: list(to) } : {}),
            ...(type === 'email' && cc.trim() ? { cc: list(cc) } : {}),
            ...(type === 'phone'
              ? { callDirection: direction, callNumber: callNumber || undefined }
              : {}),
            ...(minutes
              ? {
                  timeSpent: {
                    minutes: Number(minutes),
                    billable: true,
                    ...(activityTypeId ? { activityTypeId } : {}),
                  },
                }
              : {}),
            ...(mentions.length ? { mentions } : {}),
          }
        : { type: 'web', body: textToHtml(body) };
      if (attachmentIds.length) payload.attachmentIds = attachmentIds;
      await api('POST', `/tickets/${props.ticketId}/articles`, payload);
      setBody('');
      setMinutes('');
      setMentions([]);
      setAttachmentIds([]);
      setInfo(null);
      setKey((k) => k + 1);
      props.onTyping?.(false);
      props.onSent();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="card space-y-3" aria-label={t('article.reply')}>
      <h2 className="font-semibold">{t('article.reply')}</h2>
      {props.staff && (
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="atype" className="label">
              {t('article.type')}
            </label>
            <select
              id="atype"
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="note">{t('article.types.note')}</option>
              <option value="email">{t('article.types.email')}</option>
              <option value="phone">{t('article.types.phone')}</option>
              {props.messaging?.map((k) => (
                <option key={k} value={k}>
                  {t(`article.types.${k}`)}
                </option>
              ))}
            </select>
          </div>
          {type === 'note' && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
              />
              {t('article.internal')}
            </label>
          )}
          {type === 'email' && (
            <>
              <div className="min-w-64 flex-1">
                <label htmlFor="ato" className="label">
                  {t('article.to')}
                </label>
                <input
                  id="ato"
                  className="input"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="cliente@empresa.mx"
                />
              </div>
              <div className="min-w-48">
                <label htmlFor="acc" className="label">
                  {t('article.cc')}
                </label>
                <input
                  id="acc"
                  className="input"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                />
              </div>
            </>
          )}
          {type === 'phone' && (
            <>
              <div>
                <label htmlFor="adir" className="label">
                  {t('article.direction')}
                </label>
                <select
                  id="adir"
                  className="input"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as 'in' | 'out')}
                >
                  <option value="in">{t('article.in')}</option>
                  <option value="out">{t('article.out')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="anum" className="label">
                  {t('article.number')}
                </label>
                <input
                  id="anum"
                  className="input"
                  value={callNumber}
                  onChange={(e) => setCallNumber(e.target.value)}
                  maxLength={30}
                />
              </div>
            </>
          )}
          {meta.data?.timeAccounting?.enabled && (
            <>
              <div className="w-32">
                <label htmlFor="amin" className="label">
                  {t('article.timeSpent')}
                </label>
                <input
                  id="amin"
                  className="input"
                  type="number"
                  min={1}
                  max={1440}
                  value={minutes}
                  required={meta.data.timeAccounting.required}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </div>
              {(meta.data.activityTypes?.length ?? 0) > 0 && (
                <div>
                  <label htmlFor="aact" className="label">
                    {t('article.activity')}
                  </label>
                  <select
                    id="aact"
                    className="input"
                    value={activityTypeId}
                    onChange={(e) => setActivityTypeId(e.target.value)}
                  >
                    <option value="">—</option>
                    {meta.data.activityTypes!.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div>
        <label htmlFor="abody" className="label">
          {t('article.body')}
        </label>
        <textarea
          id="abody"
          className="input min-h-32"
          value={body}
          required
          maxLength={100_000}
          onChange={(e) => {
            setBody(
              props.staff
                ? expandTextModules(e.target.value, meta.data?.textModules ?? [])
                : e.target.value,
            );
            props.onTyping?.(e.target.value.length > 0);
          }}
        />
        {props.staff && (
          <p className="mt-1 text-xs text-slate-500">{t('article.textModuleHint')}</p>
        )}
        {props.staff && (
          <KbInsert onInsert={(text) => setBody((b) => (b ? `${b}\n\n${text}` : text))} />
        )}
      </div>
      {props.staff && (props.agents?.length ?? 0) > 0 && (
        <div>
          <label htmlFor="amention" className="label">
            {t('article.mention')}
          </label>
          <select
            id="amention"
            multiple
            className="input h-20"
            value={mentions}
            onChange={(e) => setMentions(Array.from(e.target.selectedOptions).map((o) => o.value))}
          >
            {props.agents!.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {messagingReply ? (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {t(type === 'whatsapp' ? 'article.whatsappHint' : 'article.smsHint')}
        </p>
      ) : (
        <AttachmentPicker key={key} onChange={setAttachmentIds} />
      )}
      {info && <Alert kind="info">{info}</Alert>}
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {t('article.send')}
        </button>
        {props.staff && (
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void saveShared()}
              disabled={!body}
            >
              {t('article.saveShared')}
            </button>
            <button type="button" className="btn-secondary" onClick={() => void loadShared()}>
              {t('article.loadShared')}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
