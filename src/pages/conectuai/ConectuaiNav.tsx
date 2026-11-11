import { Newspaper, UserPlus, UsersRound } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const ITEMS = [
  { to: '/conectuai', label: 'Feed', icon: Newspaper, end: true },
  { to: '/conectuai/c', label: 'Comunidades', icon: UsersRound, end: false },
  { to: '/conectuai/amigos', label: 'Amigos', icon: UserPlus, end: true },
]

/** Navegação interna do Conectuaí (mesma linguagem visual dos filtros do app). */
export function ConectuaiNav() {
  return (
    <nav aria-label="Seções do Conectuaí" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0">
      {ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold ${isActive ? 'border-brand bg-brand text-surface' : 'border-line bg-surface text-ink'}`
          }
        >
          <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
