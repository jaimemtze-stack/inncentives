import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api, uploadFile } from '../api';
import { textToHtml, useFormMeta, type Attribute } from '../lib/tickets';
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

/** Reply box for an existing ticket (agents: e-mail/note/phone; customers: portal message). */
export function Composer(props: {
  ticketId: string;
  staff: boolean;
  onSent: () => void;
  onTyping?: (t: boolean) => void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const meta = useFormMeta();
  const [type, setType] = useState<'email' | 'note' | 'phone'>('note');
  const [internal, setInternal] = useState(true);
  const [body, setBody] = useState('');
  const [to, setTo] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [callNumber, setCallNumber] = useState('');
  const [minutes, setMinutes] = useState('');
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);

  async function send(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!props.staff && !(await confirmSensitive(body, t))) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = props.staff
        ? {
            type,
            internal: type === 'note' ? internal : false,
            body: textToHtml(body),
            ...(type === 'email' && to.trim()
              ? {
                  to: to
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                }
              : {}),
            ...(type === 'phone'
              ? { callDirection: direction, callNumber: callNumber || undefined }
              : {}),
            ...(minutes ? { timeSpent: { minutes: Number(minutes), billable: true } } : {}),
          }
        : { type: 'web', body: textToHtml(body) };
      if (attachmentIds.length) payload.attachmentIds = attachmentIds;
      await api('POST', `/tickets/${props.ticketId}/articles`, payload);
      setBody('');
      setMinutes('');
      setAttachmentIds([]);
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
      </div>
      <AttachmentPicker key={key} onChange={setAttachmentIds} />
      {error && <Alert>{error}</Alert>}
      <button type="submit" className="btn-primary" disabled={busy}>
        {t('article.send')}
      </button>
    </form>
  );
}
