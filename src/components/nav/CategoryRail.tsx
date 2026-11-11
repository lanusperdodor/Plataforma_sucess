import {
  Briefcase,
  Camera,
  ChevronLeft,
  ChevronRight,
  Cpu,
  CupSoda,
  Droplets,
  Footprints,
  Gem,
  Gift,
  Hammer,
  Hand,
  IceCreamBowl,
  Package,
  Pill,
  Pizza,
  Sandwich,
  Scissors,
  Shirt,
  Smartphone,
  Soup,
  Sparkles,
  SprayCan,
  Tag,
  UtensilsCrossed,
  Watch,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import type { Category } from '../../features/catalog/schemas'

/** Mapa explícito nome-do-banco -> ícone (evita importar o pacote inteiro). */
const ICONS: Record<string, LucideIcon> = {
  Sandwich,
  Pizza,
  UtensilsCrossed,
  IceCreamBowl,
  Pill,
  Shirt,
  Footprints,
  Scissors,
  Wrench,
  Briefcase,
  Camera,
  Cpu,
  CupSoda,
  Droplets,
  Gem,
  Gift,
  Hammer,
  Hand,
  Package,
  Smartphone,
  Soup,
  Sparkles,
  SprayCan,
  Watch,
}

export function categoryIcon(name: string | null | undefined): LucideIcon {
  return (name && Object.hasOwn(ICONS, name) ? ICONS[name] : undefined) ?? Tag
}

export interface CategoryRailProps {
  categories: Category[]
  hrefFor: (category: Category) => string
  /** Slug da categoria ativa (recebe aria-current). */
  activeSlug?: string | null
  label?: string
}

export function CategoryRail({ categories, hrefFor, activeSlug, label = 'Categorias' }: CategoryRailProps) {
  const scroller = useRef<HTMLUListElement>(null)
  const scrollBy = (dir: 1 | -1) =>
    scroller.current?.scrollBy({ left: dir * 280, behavior: 'smooth' })

  const arrow =
    'hidden size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink pressable md:pointer-fine:flex'

  return (
    <nav aria-label={label} className="flex max-w-full min-w-0 items-center gap-2">
      <button type="button" aria-label="Rolar categorias para a esquerda" onClick={() => scrollBy(-1)} className={arrow}>
        <ChevronLeft aria-hidden="true" className="size-5" />
      </button>
      <ul
        ref={scroller}
        className="flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none]"
      >
        {categories.map((c) => {
          const Icon = categoryIcon(c.icon)
          const active = c.slug === activeSlug
          return (
            <li key={c.id} className="shrink-0 snap-start">
              <Link
                to={hrefFor(c)}
                aria-current={active ? 'page' : undefined}
                className={`hover-lift flex min-h-11 min-w-20 flex-col items-center justify-center gap-1 rounded-card border px-3 py-2 text-center text-xs font-medium ${
                  active ? 'border-brand bg-brand text-surface' : 'border-line bg-surface text-ink'
                }`}
              >
                <Icon aria-hidden="true" className="size-6" />
                <span className="max-w-full truncate">{c.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
      <button type="button" aria-label="Rolar categorias para a direita" onClick={() => scrollBy(1)} className={arrow}>
        <ChevronRight aria-hidden="true" className="size-5" />
      </button>
    </nav>
  )
}
