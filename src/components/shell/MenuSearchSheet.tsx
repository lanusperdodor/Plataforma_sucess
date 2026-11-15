import { Menu, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { useActiveContext } from '../../lib/activeContext.ts'
import { MenuSearchInput, matches } from '../nav/menuSearch.tsx'
import { audienceOf, destinationsFor, visibleGroups } from './destinations.ts'

/**
 * Celular: botão ☰ no topo que abre todas as abas do perfil atual com a barrinha "Buscar no menu"
 * (cliente, loja, entregador ou Master). Só organiza a navegação; o acesso é sempre conferido pelo banco.
 */
export function MenuSearchButton() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => setOpen(false), [pathname])
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-label="Menu e busca de abas"
        className="pressable inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink hover:bg-muted">
        <Menu aria-hidden="true" className="size-5" />
      </button>
      {/* fora do cabeçalho (o desfoque do cabeçalho prenderia a gaveta dentro dele) */}
      {open && createPortal(<MenuSearchSheet onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function MenuSearchSheet({ onClose }: { onClose: () => void }) {
  const { session, authz } = useAuth()
  const ctx = useActiveContext(authz)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const primary = destinationsFor(ctx, { wallet: !!authz?.roles.includes('courier_partner') })
  const groups = ctx.kind === 'entregador' ? [] : visibleGroups(audienceOf(!!session, authz), ctx)
  const items = [
    ...primary.map((d) => ({ key: d.id, to: d.to, label: d.label, icon: d.icon, group: '' })),
    ...groups.flatMap((g) => g.items.map((i) => ({ key: `${g.id}-${i.id}`, to: i.to, label: i.label, icon: i.icon, group: g.title }))),
  ].filter((i, idx, all) => all.findIndex((x) => x.to === i.to) === idx)
  const found = items.filter((i) => matches(query, i.label, i.group))

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.() }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[var(--z-sheet)]">
      <button type="button" aria-label="Fechar menu" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Menu" className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col bg-surface shadow-[var(--shadow-card)]">
        <div className="flex min-h-14 items-center justify-between gap-2 border-b border-line px-3">
          <span className="text-base font-semibold text-ink">Menu</span>
          <button type="button" onClick={onClose} aria-label="Fechar menu" className="pressable grid size-11 place-items-center rounded-full text-ink hover:bg-muted"><X aria-hidden="true" className="size-5" /></button>
        </div>
        <div className="border-b border-line p-3">
          <MenuSearchInput id="busca-menu-celular" value={query} onChange={setQuery} autoFocus
            onEnter={() => { const f = found[0]; if (f) { navigate(f.to); onClose() } }} />
        </div>
        <nav aria-label="Abas" className="flex-1 overflow-y-auto p-2">
          {found.length === 0 ? <p role="status" className="px-3 py-2 text-sm text-ink-muted">Nenhuma aba encontrada.</p> : (
            <ul className="flex flex-col gap-0.5">
              {found.map((i) => (
                <li key={i.key}>
                  <Link to={i.to} onClick={onClose} className="pressable flex min-h-12 items-center gap-3 rounded-xl px-3 text-base text-ink no-underline hover:bg-muted">
                    <i.icon aria-hidden="true" className="size-5 shrink-0 text-ink-muted" />
                    <span className="min-w-0 flex-1 truncate">{i.label}</span>
                    {i.group && <span className="shrink-0 text-xs text-ink-muted">{i.group}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </div>
    </div>
  )
}
