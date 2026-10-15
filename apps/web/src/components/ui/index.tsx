import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';

/** Minimal shadcn/ui-style primitives (accessible, dark-mode aware). */
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }
>(({ className, variant = 'primary', ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition disabled:opacity-50',
      variant === 'primary' && 'bg-brand text-brand-fg hover:opacity-90',
      variant === 'ghost' && 'hover:bg-slate-200 dark:hover:bg-slate-800',
      className,
    )}
    {...props}
  />
));
Button.displayName = 'Button';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto mt-16 w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h1 className="mb-4 text-xl font-semibold">{title}</h1>
      {children}
    </section>
  );
}

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'info';
  children: ReactNode;
}) {
  return (
    <p
      role={kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-md p-3 text-sm',
        kind === 'error'
          ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
          : 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
      )}
    >
      {children}
    </p>
  );
}
