import { Search, X } from 'lucide-react'
import type { KeyboardEvent } from 'react'

/** Texto comparável: sem acentos e sem maiúsculas ("Notificações" = "notificacoes"). */
export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** O item casa com a busca? Procura no nome e nas palavras extras (dica, grupo). */
export function matches(query: string, ...texts: (string | undefined | null)[]): boolean {
  const q = normalize(query)
  if (!q) return true
  const hay = normalize(texts.filter(Boolean).join(' '))
  return q.split(/\s+/).every((w) => hay.includes(w))
}

/** Barrinha "Buscar no menu" usada em todos os menus (site, Master, loja, entregador). Enter abre o 1º resultado. */
export function MenuSearchInput({ value, onChange, onEnter, autoFocus, id = 'busca-menu' }: {
  value: string; onChange: (v: string) => void; onEnter?: () => void; autoFocus?: boolean; id?: string
}) {
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter() }
    if (e.key === 'Escape' && value) { e.stopPropagation(); onChange('') }
  }
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">Buscar no menu</label>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} autoFocus={autoFocus}
        placeholder="Buscar no menu…" autoComplete="off" enterKeyHint="go"
        className="min-h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-9 text-sm text-ink placeholder:text-ink-muted [&::-webkit-search-cancel-button]:appearance-none" />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Limpar busca" className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-ink-muted hover:bg-muted">
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  )
}
