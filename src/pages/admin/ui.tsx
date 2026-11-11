import type { ReactNode } from 'react'

export function AdminHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  )
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-card border border-line bg-surface p-4 ${className}`}>{children}</section>
}

export const inputClass = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink'
export const primaryButton =
  'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-surface disabled:opacity-50'
export const secondaryButton =
  'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink disabled:opacity-50'
export const dangerButton =
  'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-danger px-4 text-sm font-semibold text-danger disabled:opacity-50'

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : '—'
}

export function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Algo deu errado. Tente novamente.'
}
