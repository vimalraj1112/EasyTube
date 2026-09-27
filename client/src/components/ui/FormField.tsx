import type { InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

/**
 * Labelled input with room for a validation message.
 *
 * Takes a plain input-props object so a react-hook-form `register()` result can
 * be spread straight into it.
 */
export function TextField({ label, error, hint, className, id, ...inputProps }: TextFieldProps) {
  const fieldId = id ?? inputProps.name;
  const messageId = fieldId ? `${fieldId}-message` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-ink-200">
        {label}
      </label>
      <input
        {...inputProps}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        className={cn(
          'rounded-xl border bg-ink-1000/60 px-3.5 py-2.5 text-sm text-ink-50 outline-none transition-colors duration-200',
          'placeholder:text-ink-500 focus:border-brand-400',
          error ? 'border-rose-400/60' : 'border-ink-100/15',
          className,
        )}
      />
      {error ? (
        <p id={messageId} role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface FormAlertProps {
  tone: 'danger' | 'success';
  children: string;
}

/** Single-line form-level message, used for server and network failures. */
export function FormAlert({ tone, children }: FormAlertProps) {
  return (
    <p
      role="alert"
      className={cn(
        'rounded-xl border px-3.5 py-3 text-sm',
        tone === 'danger'
          ? 'border-rose-400/25 bg-rose-400/10 text-rose-200'
          : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
      )}
    >
      {children}
    </p>
  );
}
