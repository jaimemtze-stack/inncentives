import { useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api';

export function Field(props: {
  label: string;
  name: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  hint?: string;
  required?: boolean;
  inputMode?: 'numeric' | 'text' | 'email';
  pattern?: string;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  const id = `f-${props.name}`;
  return (
    <div>
      <label htmlFor={id} className="label">
        {props.label}
      </label>
      <input
        id={id}
        name={props.name}
        className="input"
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        required={props.required ?? true}
        inputMode={props.inputMode}
        pattern={props.pattern}
        maxLength={props.maxLength}
        autoFocus={props.autoFocus}
        aria-describedby={props.hint ? `${id}-hint` : undefined}
      />
      {props.hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-plum-500">
          {props.hint}
        </p>
      )}
    </div>
  );
}

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const styles = {
    error:
      'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
    success:
      'border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200',
    info: 'border-brand-300 bg-brand-50 text-brand-900 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-200',
  }[kind];
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-3 py-2 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

/** Maps API error codes to translated, non-technical messages. */
export function useErrorText() {
  const { t } = useTranslation();
  return useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        if (err.code === 'rate_limited')
          return t('errors.rate_limited', { s: err.retryAfter ?? 60 });
        const key = `errors.${err.code}`;
        const text = t(key);
        return text === key ? t('errors.generic') : text;
      }
      return t('errors.generic');
    },
    [t],
  );
}

export function CenteredCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto mt-12 w-full max-w-md px-4">
      <div className="card">
        <h1 className="mb-6 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}
