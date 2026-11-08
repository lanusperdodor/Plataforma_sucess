import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { forwardRef, useId } from 'react'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  const base =
    'inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-colors duration-150 disabled:opacity-50'
  const style =
    variant === 'primary'
      ? 'bg-brand text-white hover:bg-accent'
      : 'bg-transparent text-brand hover:bg-brand/10'
  return <button className={`${base} ${style} ${className}`} {...props} />
}

export const Field = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }
>(function Field({ label, error, ...props }, ref) {
  const id = useId()
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        className="min-h-11 w-full rounded-xl border border-ink/20 bg-surface px-3 text-sm"
        {...props}
      />
      {error && (
        <p id={`${id}-err`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
})

export function Card({ children, title, subtitle }: { children: ReactNode; title?: string; subtitle?: string }) {
  return (
    <section className="mx-auto w-full max-w-md rounded-2xl border border-ink/10 bg-surface p-6 shadow-[var(--shadow-card)] sm:p-8">
      {title && <h1 className={`text-2xl font-bold text-ink ${subtitle ? 'mb-1' : 'mb-4'}`}>{title}</h1>}
      {subtitle && <p className="mb-5 text-sm text-ink-muted">{subtitle}</p>}
      {children}
    </section>
  )
}

export function Notice({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  const color =
    kind === 'error' ? 'text-danger' : kind === 'success' ? 'text-success' : 'text-ink/80'
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${color}`}>
      {children}
    </p>
  )
}
