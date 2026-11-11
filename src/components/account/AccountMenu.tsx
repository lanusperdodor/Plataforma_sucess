import { useQuery } from '@tanstack/react-query'
import { Bike, ChevronDown, LayoutDashboard, LogOut, ReceiptText, ShieldCheck, Store, UserRound } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getAccountIdentity } from '../../features/account/repository.ts'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { activeRole, displayName } from './identity.ts'
import { ThemeChooser, ThemeToggleButton } from './ThemeToggle.tsx'

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
  return { signedIn: !!session, name: displayName(q.data, email), role: activeRole(authz, q.data), loading: q.isLoading }
}

const item = 'pressable flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-ink hover:bg-muted'

/**
 * Conta no cabeçalho (componente único para site, painéis e Master): avatar com inicial, primeiro nome
 * e perfil ativo; ao clicar, menu com atalhos do perfil, tema e sair. Sem sessão: Entrar / Criar conta.
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { session, authz, signOut } = useAuth()
  const { signedIn, name, role } = useAccountIdentity()
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
        {!compact && <ThemeToggleButton />}
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

  const staff = !!authz && (authz.roles.includes('platform_master') || authz.roles.includes('platform_operator'))
  const courier = !!authz?.roles.includes('courier_partner')
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
        <span className={`min-w-0 flex-col leading-tight ${compact ? 'hidden min-[380px]:flex' : 'flex'}`}>
          <span className="truncate text-sm font-semibold text-ink">{name}</span>
          {role && !compact && <span className="truncate text-xs text-ink-muted">{role}</span>}
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      </button>
      {open && (
        <div id={menuId} role="menu" className="absolute right-0 top-full z-[var(--z-sheet)] mt-2 w-72 rounded-2xl border border-line bg-surface p-2 shadow-lg">
          <div className="px-3 py-2">
            <p className="truncate font-semibold text-ink">{name}</p>
            {role && <p className="truncate text-xs text-ink-muted">{role}</p>}
          </div>
          <Link role="menuitem" to="/conta" onClick={close} className={item}><UserRound aria-hidden="true" className="size-4" />Minha conta</Link>
          <Link role="menuitem" to="/pedidos" onClick={close} className={item}><ReceiptText aria-hidden="true" className="size-4" />Meus pedidos</Link>
          {(authz?.memberships ?? []).length > 0 && (
            <Link role="menuitem" to="/painel" onClick={close} className={item}><Store aria-hidden="true" className="size-4" />Painel do estabelecimento</Link>
          )}
          {courier && <Link role="menuitem" to="/entregador" onClick={close} className={item}><Bike aria-hidden="true" className="size-4" />Área do entregador</Link>}
          {staff && <Link role="menuitem" to="/admin" onClick={close} className={item}><ShieldCheck aria-hidden="true" className="size-4" />Painel Master</Link>}
          {!staff && !courier && (authz?.memberships ?? []).length === 0 && (
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
