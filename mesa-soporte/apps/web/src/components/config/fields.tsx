import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';

/** A configuration record as edited by the forms (validated by the API on save). */
export type Rec = Record<string, unknown>;
export type Options = ReadonlyArray<readonly [string, string]>;

export const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
export const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : []);
export const rec = (v: unknown): Rec =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
export const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);
export const numOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** Translated options for a fixed list of values: t(`${prefix}.${value}`). */
export function useOptions(prefix: string, values: readonly string[]): Options {
  const { t } = useTranslation();
  return values.map((v) => [v, t(`${prefix}.${v}`, { defaultValue: v })] as const);
}

function Labeled(props: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={props.id} className="label">
        {props.label}
      </label>
      {props.children}
      {props.hint && <p className="mt-1 text-xs text-plum-500">{props.hint}</p>}
    </div>
  );
}

export function TextIn(props: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  hint?: string;
  type?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <Labeled id={id} label={props.label} hint={props.hint}>
      <input
        id={id}
        className="input"
        type={props.type ?? 'text'}
        value={str(props.value)}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </Labeled>
  );
}

export function TextArea(props: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  hint?: string;
  rows?: number;
}) {
  const id = useId();
  return (
    <Labeled id={id} label={props.label} hint={props.hint}>
      <textarea
        id={id}
        className="input"
        rows={props.rows ?? 4}
        value={str(props.value)}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </Labeled>
  );
}

/** Number input; an empty box is null. */
export function NumIn(props: {
  label: string;
  value: unknown;
  onChange: (v: number | null) => void;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const id = useId();
  const v = numOrNull(props.value);
  return (
    <Labeled id={id} label={props.label} hint={props.hint}>
      <input
        id={id}
        className="input"
        type="number"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={v === null ? '' : v}
        onChange={(e) => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </Labeled>
  );
}

export function Check(props: { label: string; value: unknown; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={props.value === true}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  );
}

/** Select; with `empty` an extra "none" option maps to null. */
export function SelectIn(props: {
  label: string;
  value: unknown;
  onChange: (v: string | null) => void;
  options: Options;
  empty?: boolean;
  hint?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const current = str(props.value);
  const known = props.options.some(([v]) => v === current);
  return (
    <Labeled id={id} label={props.label} hint={props.hint}>
      <select
        id={id}
        className="input"
        value={current}
        onChange={(e) => props.onChange(e.target.value === '' ? null : e.target.value)}
      >
        {(props.empty || !current) && <option value="">{t('cfg.none')}</option>}
        {current && !known && <option value={current}>{current}</option>}
        {props.options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Labeled>
  );
}

export function MultiCheck(props: {
  label: string;
  value: unknown;
  onChange: (v: string[]) => void;
  options: Options;
}) {
  const selected = strs(props.value);
  return (
    <fieldset>
      <legend className="label">{props.label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {props.options.map(([v, l]) => (
          <label key={v} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(v)}
              onChange={(e) =>
                props.onChange(
                  e.target.checked ? [...selected, v] : selected.filter((x) => x !== v),
                )
              }
            />
            {l}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Comma-separated list of free values (tags, allowed options…). */
export function ListIn(props: {
  label: string;
  value: unknown;
  onChange: (v: string[]) => void;
  hint?: string;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(strs(props.value).join(', '));
  return (
    <TextIn
      label={props.label}
      value={text}
      hint={props.hint ?? t('cfg.listHint')}
      onChange={(v) => {
        setText(v);
        props.onChange(
          v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}

let keySeq = 0;
const newKey = () => ++keySeq;

/** Repeatable rows with add/remove buttons. */
export function Rows<T>(props: {
  label?: string;
  items: T[];
  onChange: (items: T[]) => void;
  make: () => T;
  render: (item: T, set: (v: T) => void) => ReactNode;
  addLabel?: string;
  max?: number;
}) {
  const { t } = useTranslation();
  // Stable row keys, so local input state follows its row when another is removed.
  const [keys, setKeys] = useState(() => props.items.map(() => newKey()));
  while (keys.length < props.items.length) keys.push(newKey());
  const body = (
    <div className="space-y-2">
      {props.items.map((item, i) => (
        <div
          key={keys[i]}
          className="flex items-start gap-2 rounded border border-plum-200 p-2 dark:border-plum-700"
        >
          <div className="min-w-0 flex-1">
            {props.render(item, (v) =>
              props.onChange(props.items.map((x, j) => (j === i ? v : x))),
            )}
          </div>
          <button
            type="button"
            className="text-sm text-red-700 underline"
            onClick={() => {
              setKeys(keys.filter((_, j) => j !== i));
              props.onChange(props.items.filter((_, j) => j !== i));
            }}
          >
            {t('cfg.remove')}
          </button>
        </div>
      ))}
      {(props.max === undefined || props.items.length < props.max) && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => props.onChange([...props.items, props.make()])}
        >
          {props.addLabel ?? t('cfg.add')}
        </button>
      )}
    </div>
  );
  if (!props.label) return body;
  return (
    <fieldset>
      <legend className="label">{props.label}</legend>
      {body}
    </fieldset>
  );
}

export function Section(props: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded border border-plum-200 p-3 dark:border-plum-700">
      <legend className="px-1 text-sm font-semibold">{props.title}</legend>
      {props.children}
    </fieldset>
  );
}

// ---------------------------------------------------------------- references

export type RefSource =
  | 'groups'
  | 'priorities'
  | 'calendars'
  | 'signatures'
  | 'webhooks'
  | 'support-plans'
  | 'staff'
  | 'users'
  | 'organizations';

/** Records other forms point to, as [id, label] options. */
export function useRefOptions(source: RefSource): Options {
  const q = useQuery({
    queryKey: ['config-ref', source],
    staleTime: 30_000,
    queryFn: async (): Promise<Options> => {
      if (source === 'staff' || source === 'users') {
        const r = await api<{
          items: Array<{ id: string; name: string; email: string; role: string }>;
        }>('GET', '/admin/users?limit=100');
        return r.items
          .filter((u) => source === 'users' || u.role !== 'CUSTOMER')
          .map((u) => [u.id, `${u.name} · ${u.email}`] as const);
      }
      if (source === 'organizations') {
        const r = await api<{ items: Array<{ id: string; name: string }> }>(
          'GET',
          '/admin/organizations?limit=100',
        );
        return r.items.map((o) => [o.id, o.name] as const);
      }
      const rows = await api<Rec[]>('GET', `/admin/config/${source}`);
      return rows.map((r) => [str(r.id), str(r.name)] as const);
    },
  });
  return q.data ?? [];
}

export function RefSelect(props: {
  label: string;
  source: RefSource;
  value: unknown;
  onChange: (v: string | null) => void;
  empty?: boolean;
  hint?: string;
}) {
  const options = useRefOptions(props.source);
  return <SelectIn {...props} options={options} />;
}

export function RefMulti(props: {
  label: string;
  source: RefSource;
  value: unknown;
  onChange: (v: string[]) => void;
}) {
  const options = useRefOptions(props.source);
  return <MultiCheck {...props} options={options} />;
}
