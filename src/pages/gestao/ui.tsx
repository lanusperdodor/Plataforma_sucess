import { Crown, Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatBRL } from '../../lib/money.ts'

export const field = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink'
export const primary = 'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-surface disabled:opacity-50'
export const secondary = 'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink disabled:opacity-50'
export const ghost = 'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold text-ink hover:bg-muted disabled:opacity-50'
export const box = 'rounded-card border border-line bg-surface p-4 md:p-6'
export const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Algo deu errado. Tente novamente.')
/** Valor com sinal (diferença de caixa, lucro). */
export const money = (c: number) => (c < 0 ? `− ${formatBRL(Math.round(-c))}` : formatBRL(Math.round(c)))
/** "12,50" → 1250 (aceita vírgula ou ponto; vazio → null). */
export function parseCents(v: string): number | null {
  const t = v.trim().replace(/\s|R\$/g, '')
  if (!t) return null
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(norm)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
export function since(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
}

export function SectionTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <span aria-hidden="true" className="mb-2 block h-1 w-12 rounded-full bg-linear-to-r from-tone-blue via-tone-violet to-tone-orange" />
        <h1 className="text-xl font-bold text-ink md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-lg font-bold tabular-nums text-ink">{value}</dd>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}

export function PremiumBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
      <Crown aria-hidden="true" className="size-3" />Premium
    </span>
  )
}

/** Exibido no lugar de um módulo Premium quando o plano não inclui. O banco também recusa. */
export function PremiumUpsell({ businessId, feature }: { businessId: string; feature: string }) {
  return (
    <section className={`${box} flex flex-col items-start gap-3`}>
      <span className="grid size-11 place-items-center rounded-2xl bg-muted text-ink"><Lock aria-hidden="true" className="size-5" /></span>
      <h2 className="text-lg font-bold text-ink">{feature} faz parte do plano Premium</h2>
      <p className="max-w-prose text-sm text-ink-muted">
        O Premium (R$ 99/mês) inclui comandas e mesas, caixa presencial, QR das mesas, controle de gastos, Meu Lucro, calculadora de custos e relatórios avançados.
        O plano Padrão (R$ 79/mês) continua com loja, cardápio, pedidos de delivery e vendas.
      </p>
      <Link to={`/painel/${businessId}/configuracoes`} className={primary}>Conhecer o Premium</Link>
    </section>
  )
}
