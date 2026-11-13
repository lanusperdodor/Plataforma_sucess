import { useQuery } from '@tanstack/react-query'
import { Bike, Check, ChevronDown, LayoutDashboard, LogOut, ReceiptText, ShieldCheck, ShoppingBag, Store, UserRound } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getAccountIdentity } from '../../features/account/repository.ts'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { availableContexts, contextHome, setActiveContext, useActiveContext, type ActiveContext } from '../../lib/activeContext.ts'
import { activeRole, displayName } from './identity.ts'
import { ThemeChooser } from './ThemeToggle.tsx'

export function useAccountIdentity() {
  const { session, authz } = useAuth()
  const userId = session?.user.id ?? ''
  const ids = (authz?.memberships ?? []).map((m) => m.businessId)
  const q = useQuery({
    queryKey: ['me', 'identity', userId, ids.join(',')],
    queryFn: () => getAccountIdentity(userId, ids),
    enabled: !!userId,
    staleTime: 60_000,
  })
  const email = session?.user.email ?? null
  return { signedIn: !!session, name: displayName(q.data, email), role: activeRole(authz, q.data), loading: q.isLoading, businesses: q.data?.businesses ?? {} }
}

const sameContext = (a: ActiveContext, b: ActiveContext) => a.kind === b.kind && (a.kind !== 'loja' || (b.kind === 'loja' && a.businessId === b.businessId))

const item = 'pressable flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-ink hover:bg-muted'

/**
 * Conta no cabeçalho (componente único para site, painéis e Master): avatar com inicial, primeiro nome
 * e perfil ativo; ao clicar, menu com atalhos do perfil, tema e sair. Sem sessão: Entrar / Criar conta.
 */
export function AccountMenu({ compact = false, context = 'site' }: { compact?: boolean; context?: 'site' | 'admin' }) {
  const { session, authz, signOut } = useAuth()
  const { signedIn, name, role, businesses } = useAccountIdentity()
  const active = useActiveContext(authz)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!signedIn || !session) {
    return (
      <div className="flex items-center gap-1">
        <Link to="/entrar" className="pressable inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm font-semibold text-ink">
          Entrar
        </Link>
        {!compact && (
          <Link to="/cadastro" className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-3 text-sm font-semibold text-ink">
            Criar conta
          </Link>
        )}
      </div>
    )
  }

  const close = () => setOpen(false)
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Conta de ${name}${role ? ` (${role})` : ''}`}
        onClick={() => setOpen((v) => !v)}
        className="pressable inline-flex min-h-11 max-w-[14rem] items-center gap-2 rounded-full bg-muted py-1 pl-1 pr-2 text-left"
      >
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-orange text-sm font-bold uppercase text-ink">
          {name.slice(0, 1)}
        </span>
        <span className={`min-w-0 flex-col leading-tight ${compact ? 'hidden sm:flex' : 'flex'}`}>
          <span className="truncate text-sm font-semibold text-ink">{name}</span>
          {role && !compact && <span className="truncate text-xs text-ink-muted">{role}</span>}
        </span>
        <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-ink-muted ${compact ? 'hidden sm:block' : ''}`} />
      </button>
      {open && (
        <div id={menuId} role="menu" className="absolute right-0 top-full z-[var(--z-sheet)] mt-2 w-72 rounded-2xl border border-line bg-surface p-2 shadow-lg">
          <div className="px-3 py-2">
            <p className="truncate font-semibold text-ink">{name}</p>
            {role && <p className="truncate text-xs text-ink-muted">{role}</p>}
          </div>
          {availableContexts(authz).length > 1 && (
            <div role="group" aria-label="Perfil ativo" className="mb-1 border-b border-line pb-2">
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Usar como</p>
              {/* minha área (loja, entregador, Master) sempre antes de "Cliente" */}
              {[...availableContexts(authz)].sort((a, b) => Number(a.kind === 'cliente') - Number(b.kind === 'cliente')).map((c) => {
                const label = c.kind === 'cliente' ? 'Cliente (minhas compras)' : c.kind === 'loja' ? `${businesses[c.businessId] ?? 'Minha loja'} (pedidos recebidos)` : c.kind === 'entregador' ? 'Entregador' : 'Painel Master'
                const Icon = c.kind === 'cliente' ? ShoppingBag : c.kind === 'loja' ? Store : c.kind === 'entregador' ? Bike : ShieldCheck
                const on = context === 'admin' ? c.kind === 'master' : sameContext(c, active)
                return (
                  <button key={c.kind === 'loja' ? c.businessId : c.kind} type="button" role="menuitemradio" aria-checked={on}
                    onClick={() => { setActiveContext(c); close(); navigate(contextHome(c)) }} className={`${item} w-full text-left`}>
                    <Icon aria-hidden="true" className="size-4" /><span className="flex-1 truncate">{label}</span>{on && <Check aria-hidden="true" className="size-4 text-accent" />}
                  </button>
                )
              })}
            </div>
          )}
          <Link role="menuitem" to="/conta" onClick={close} className={item}><UserRound aria-hidden="true" className="size-4" />Minha conta</Link>
          {context === 'site' && active.kind === 'cliente' && (
            <Link role="menuitem" to="/pedidos" onClick={close} className={item}><ReceiptText aria-hidden="true" className="size-4" />Meus pedidos</Link>
          )}
          {context === 'admin' && <Link role="menuitem" to="/" onClick={close} className={item}><LayoutDashboard aria-hidden="true" className="size-4" />Ir para o site</Link>}
          {availableContexts(authz).length <= 1 && context === 'site' && (
            <Link role="menuitem" to="/perfil" onClick={close} className={item}><LayoutDashboard aria-hidden="true" className="size-4" />Perfil</Link>
          )}
          <div className="my-2 px-1"><ThemeChooser /></div>
          <button
            type="button"
            role="menuitem"
            onClick={() => { close(); void signOut().then(() => navigate('/', { replace: true })) }}
            className={`${item} w-full`}
          >
            <LogOut aria-hidden="true" className="size-4" />Sair
          </button>
        </div>
      )}
    </div>
  )
}
