import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface PageHeaderProps {
  title: string
  subtitle?: string
  icon?: LucideIcon
  actions?: ReactNode
}

/** Cabeçalho padrão das abas: título forte, subtítulo curto; ícone só em telas largas. */
export function PageHeader({ title, subtitle, icon: Icon, actions }: PageHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span aria-hidden="true" className="hidden size-11 shrink-0 place-items-center rounded-2xl bg-brand text-orange md:grid">
            <Icon className="size-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight text-ink md:text-3xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-ink-muted md:text-base">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export function DemoTag({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-muted ${className}`}>
      Demonstração
    </span>
  )
}

/** Página: espaçamento e largura comuns a todas as abas. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4 p-4 md:gap-6 md:p-6">{children}</div>
}