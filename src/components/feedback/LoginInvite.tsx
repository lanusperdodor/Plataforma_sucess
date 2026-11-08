import { LogIn, type LucideIcon } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

export interface LoginInviteProps {
  title: string
  description: string
  icon?: LucideIcon
}

/** Convite de login compacto para áreas pessoais. Preserva a rota de volta (state.from). */
export function LoginInvite({ title, description, icon: Icon = LogIn }: LoginInviteProps) {
  const location = useLocation()
  const from = location.pathname + location.search
  return (
    <section className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 md:p-4">
      <span aria-hidden="true" className="hidden size-10 shrink-0 place-items-center rounded-xl bg-orange text-ink sm:grid">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold text-ink md:text-base">{title}</h2>
        <p className="text-xs text-ink-muted md:text-sm">{description}</p>
      </div>
      <Link to="/entrar" state={{ from }} className="pressable inline-flex min-h-11 shrink-0 items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">
        Entrar
      </Link>
    </section>
  )
}