'use client'

import { useFormStatus } from 'react-dom'

/**
 * Form primitives shared by auth, studio and admin.
 *
 * Every field wires `aria-invalid` and `aria-describedby` to its error node —
 * without those, a screen reader announces the input as valid and the message
 * never gets read out, which is the most common accessibility failure in
 * hand-rolled forms.
 */

export function Field({
  label,
  name,
  type = 'text',
  errors,
  hint,
  required,
  defaultValue,
  placeholder,
  autoComplete,
  value,
  onChange,
  list,
}: {
  label: string
  name: string
  type?: string
  errors?: string[]
  hint?: string
  required?: boolean
  defaultValue?: string
  placeholder?: string
  autoComplete?: string
  /** Pass with `onChange` to drive the input from parent state. */
  value?: string
  onChange?: (value: string) => void
  /** id of a <datalist> to offer suggestions from. */
  list?: string
}) {
  const errorId = `${name}-error`
  const hintId = `${name}-hint`
  const hasError = !!errors?.length

  // A React input must be consistently controlled or uncontrolled; switching
  // between the two mid-life logs a warning and loses the value.
  const controlled = value !== undefined && onChange !== undefined

  return (
    <div>
      <label htmlFor={name} className="block text-xs font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>

      <input
        id={name}
        name={name}
        type={type}
        required={required}
        list={list}
        {...(controlled
          ? { value, onChange: (e) => onChange(e.target.value) }
          : { defaultValue })}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={hasError || undefined}
        aria-describedby={
          [hasError ? errorId : null, hint ? hintId : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
        className={`mt-1 h-9 w-full rounded-lg border bg-surface px-3 text-sm text-foreground placeholder:text-muted focus:outline-none ${
          hasError
            ? 'border-danger focus:border-danger'
            : 'border-border focus:border-accent'
        }`}
      />

      {hint && !hasError && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}

      {hasError && (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {errors[0]}
        </p>
      )}
    </div>
  )
}

export function TextareaField({
  label,
  name,
  errors,
  hint,
  required,
  rows = 4,
  defaultValue,
  placeholder,
  maxLength,
}: {
  label: string
  name: string
  errors?: string[]
  hint?: string
  required?: boolean
  rows?: number
  defaultValue?: string
  placeholder?: string
  maxLength?: number
}) {
  const errorId = `${name}-error`
  const hasError = !!errors?.length

  return (
    <div>
      <label htmlFor={name} className="block text-xs font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>

      <textarea
        id={name}
        name={name}
        rows={rows}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : undefined}
        className={`mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none ${
          hasError
            ? 'border-danger focus:border-danger'
            : 'border-border focus:border-accent'
        }`}
      />

      {hint && !hasError && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {hasError && (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {errors[0]}
        </p>
      )}
    </div>
  )
}

export function CheckboxField({
  name,
  errors,
  children,
  defaultChecked,
}: {
  name: string
  errors?: string[]
  children: React.ReactNode
  defaultChecked?: boolean
}) {
  const errorId = `${name}-error`
  const hasError = !!errors?.length

  return (
    <div>
      <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? errorId : undefined}
          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
        />
        <span>{children}</span>
      </label>
      {hasError && (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {errors[0]}
        </p>
      )}
    </div>
  )
}

/**
 * Submit button that disables itself while the action is in flight.
 * `useFormStatus` must be read from a child of the <form>, not the form
 * component itself — that is why this is its own component.
 */
export function SubmitButton({
  children,
  pendingLabel = 'Working…',
  variant = 'primary',
  className = '',
}: {
  children: React.ReactNode
  pendingLabel?: string
  variant?: 'primary' | 'secondary' | 'danger'
  className?: string
}) {
  const { pending } = useFormStatus()

  const styles = {
    primary: 'bg-accent text-accent-contrast hover:bg-accent-hover',
    secondary:
      'border border-border bg-surface text-foreground hover:bg-surface-raised',
    danger: 'bg-danger text-white hover:opacity-90',
  }[variant]

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
    >
      {pending ? pendingLabel : children}
    </button>
  )
}

export function FormMessage({
  error,
  success,
}: {
  error?: string
  success?: string
}) {
  if (!error && !success) return null

  return (
    <p
      role="status"
      aria-live="polite"
      className={`rounded-lg border p-3 text-xs leading-relaxed ${
        error
          ? 'border-danger/30 bg-danger/10 text-danger'
          : 'border-success/30 bg-success/10 text-success'
      }`}
    >
      {error ?? success}
    </p>
  )
}
