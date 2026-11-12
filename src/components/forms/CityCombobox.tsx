import { Check, ChevronDown, Search } from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'

export interface CityOption { id: string; name: string; state: string }

/** Texto sem acento e minúsculo ("itau" encontra "Itaú de Minas"). */
export const foldText = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * Campo de cidade com busca digitada (combobox acessível): filtra por nome ou UF sem exigir acento,
 * setas ↑/↓ para navegar, Enter para escolher, Esc para fechar.
 */
export function CityCombobox({ id, label, cities, value, onChange, placeholder = 'Digite o nome da cidade', loading = false }: {
  id: string; label: string; cities: CityOption[]; value: string; onChange: (id: string) => void; placeholder?: string; loading?: boolean
}) {
  const selected = cities.find((c) => c.id === value) ?? null
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => {
    const q = foldText(text)
    const list = q ? cities.filter((c) => foldText(`${c.name} ${c.state}`).includes(q) || foldText(`${c.name} - ${c.state}`).includes(q)) : cities
    return [...list].sort((a, b) => Number(!foldText(a.name).startsWith(q)) - Number(!foldText(b.name).startsWith(q)) || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 50)
  }, [cities, text])
  const choose = (c: CityOption) => { onChange(c.id); setText(''); setOpen(false) }
  const shown = open ? text : selected ? `${selected.name} - ${selected.state}` : text
  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${results[active]!.id}` : undefined}
          autoComplete="off"
          value={shown}
          placeholder={loading ? 'Carregando cidades…' : placeholder}
          onFocus={() => { setOpen(true); setText(''); setActive(0) }}
          onBlur={() => globalThis.setTimeout(() => setOpen(false), 120)}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, results.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); choose(results[active]!) }
            else if (e.key === 'Escape') { setOpen(false); setText('') }
          }}
          className="min-h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-9 text-sm text-ink"
        />
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
      </div>
      {open && (
        <ul id={listId} role="listbox" aria-label={label} className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-[var(--shadow-card)]">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-muted">{loading ? 'Carregando…' : 'Nenhuma cidade encontrada.'}</li>
          ) : results.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${c.id}`}
              role="option"
              aria-selected={c.id === value}
              onMouseDown={(e) => { e.preventDefault(); choose(c) }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm text-ink ${i === active ? 'bg-muted' : ''}`}
            >
              <span>{c.name} - {c.state}</span>
              {c.id === value && <Check aria-hidden="true" className="size-4" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
