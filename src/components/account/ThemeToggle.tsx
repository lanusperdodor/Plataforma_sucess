import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemePreference } from '../../lib/theme.ts'

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Automático', icon: Monitor },
]

/** Escolha de tema: claro, escuro ou automático (segue o aparelho). */
export function ThemeChooser() {
  const { preference, setPreference } = useTheme()
  return (
    <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={preference === o.value}
          onClick={() => setPreference(o.value)}
          className={`pressable inline-flex min-h-10 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-semibold ${preference === o.value ? 'bg-surface text-ink shadow-[var(--shadow-card)]' : 'text-ink-muted'}`}
        >
          <o.icon aria-hidden="true" className="size-4" />
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Botão de tema bem visível: pílula com borda, ícone e o nome do modo para onde vai (no celular, só o ícone em destaque). */
export function ThemeToggleButton({ className = '' }: { className?: string }) {
  const { resolved, setPreference } = useTheme()
  const dark = resolved === 'dark'
  return (
    <button
      type="button"
      onClick={() => setPreference(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Usar modo claro' : 'Usar modo escuro'}
      title={dark ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'}
      className={`pressable inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border-2 border-orange bg-orange/15 px-2.5 text-sm font-semibold text-ink md:px-3 ${className}`}
    >
      {dark ? <Sun aria-hidden="true" className="size-5 text-accent" /> : <Moon aria-hidden="true" className="size-5 text-accent" />}
      <span className="hidden md:inline">{dark ? 'Claro' : 'Escuro'}</span>
    </button>
  )
}
