export interface ChipOption<T extends string> {
  value: T
  label: string
}

export interface FilterChipsProps<T extends string> {
  label: string
  options: readonly ChipOption<T>[]
  value: T
  onChange: (value: T) => void
}

/** Grupo de chips de seleção única (rolagem horizontal no celular). Acessível como radiogroup. */
export function FilterChips<T extends string>({ label, options, value, onChange }: FilterChipsProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`pressable min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${
              active ? 'border-brand bg-brand text-surface' : 'border-line bg-surface text-ink'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}