import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bike, ChefHat, Store, UtensilsCrossed, ShoppingBag } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { getKitchen, setItemStatus, type KitchenLine } from '../../features/gestao/repository.ts'
import { updateOrderStatus } from '../../features/orders/repository.ts'
import { useGestao } from './context.ts'
import { hhmm, msg, primary, secondary, SectionTitle, since } from './ui.tsx'

const ORIGIN = {
  delivery: { label: 'Delivery', icon: Bike },
  retirada: { label: 'Retirada', icon: ShoppingBag },
  mesa: { label: 'Mesa', icon: UtensilsCrossed },
  balcao: { label: 'Balcão', icon: Store },
} as const

const LINE_STATUS: Record<string, string> = {
  accepted: 'Aguardando preparo', preparing: 'Em preparo', novo: 'Novo', em_preparo: 'Em preparo', pronto: 'Pronto',
}

interface Ticket { key: string; origin: KitchenLine['origin']; refId: string; refLabel: string; createdAt: string; status: string; lines: KitchenLine[] }

/** Agrupa: pedido inteiro (delivery/retirada) ou itens da comanda por etapa. */
function tickets(lines: KitchenLine[]): Ticket[] {
  const map = new Map<string, Ticket>()
  for (const l of lines) {
    const key = l.origin === 'mesa' || l.origin === 'balcao' ? `${l.refId}:${l.status}` : l.refId
    const t = map.get(key) ?? { key, origin: l.origin, refId: l.refId, refLabel: l.refLabel, createdAt: l.createdAt, status: l.status, lines: [] }
    t.lines.push(l)
    if (l.createdAt < t.createdAt) t.createdAt = l.createdAt
    map.set(key, t)
  }
  return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Cozinha (restaurante) ou separação (mercadinho): delivery, retirada, mesa e balcão numa só fila. */
export function KitchenTab() {
  const { business: b, niche, can } = useGestao()
  const qc = useQueryClient()
  const toast = useToast()
  const [filter, setFilter] = useState<'todos' | KitchenLine['origin']>('todos')
  const q = useQuery({ queryKey: ['gestao', 'kitchen', b.id], queryFn: () => getKitchen(b.id), refetchInterval: 20_000 })
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = globalThis.setInterval(() => setNow(Date.now()), 30_000)
    return () => globalThis.clearInterval(t)
  }, [])
  const all = useMemo(() => tickets(q.data ?? []), [q.data])
  const list = filter === 'todos' ? all : all.filter((t) => t.origin === filter)
  const canAct = can('orders.update_status') || can('tabs.manage')
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['gestao'] })
    void qc.invalidateQueries({ queryKey: ['merchant', 'orders', b.id] })
  }
  const advance = useMutation({
    mutationFn: async (t: Ticket) => {
      if (t.origin === 'delivery' || t.origin === 'retirada') {
        await updateOrderStatus(t.refId, t.status === 'accepted' ? 'preparing' : 'ready')
        return t.status === 'accepted' ? 'Preparo iniciado.' : 'Pedido pronto. Aguardando coleta.'
      }
      const next = t.status === 'novo' ? 'em_preparo' : t.status === 'em_preparo' ? 'pronto' : 'servido'
      for (const l of t.lines) await setItemStatus(l.itemId, next)
      return next === 'em_preparo' ? 'Preparo iniciado.' : next === 'pronto' ? 'Itens prontos.' : 'Itens servidos.'
    },
    onSuccess: (m) => { toast.success(m); refresh() },
    onError: (e) => { toast.error(msg(e)); refresh() },
  })
  const nextLabel = (t: Ticket) =>
    t.status === 'accepted' || t.status === 'novo' ? 'Iniciar preparo' : t.status === 'preparing' || t.status === 'em_preparo' ? (niche === 'mercadinho' ? 'Separado' : 'Pronto') : 'Servido'
  const counts = (o: KitchenLine['origin']) => all.filter((t) => t.origin === o).length
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle
        title={niche === 'mercadinho' ? 'Separação' : 'Cozinha'}
        subtitle="Fila única: delivery, retirada, mesas e balcão. Atualiza sozinha."
      />
      <div role="group" aria-label="Filtrar origem" className="flex gap-2 overflow-x-auto">
        {(['todos', 'delivery', 'retirada', 'mesa', 'balcao'] as const).map((o) => (
          <button key={o} type="button" aria-pressed={filter === o} onClick={() => setFilter(o)} className={`${filter === o ? primary : secondary} shrink-0`}>
            {o === 'todos' ? `Todos (${all.length})` : `${ORIGIN[o].label} (${counts(o)})`}
          </button>
        ))}
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={ChefHat} title={q.isLoading ? 'Carregando…' : 'Nada na fila agora'} description="Pedidos aceitos e itens enviados das comandas aparecem aqui." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => {
            const O = ORIGIN[t.origin]
            const late = now - new Date(t.createdAt).getTime() > 25 * 60000
            return (
              <li key={t.key} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"><O.icon aria-hidden="true" className="size-3.5" />{O.label}</p>
                    <p className="truncate font-bold text-ink">{t.refLabel}</p>
                  </div>
                  <div className="text-right text-xs text-ink-muted">
                    <p>{hhmm(t.createdAt)}</p>
                    <p className={late ? 'font-semibold text-danger' : ''}>há {since(t.createdAt, now)}</p>
                  </div>
                </div>
                <p className="w-fit rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-ink">{LINE_STATUS[t.status] ?? t.status}</p>
                <ul className="flex flex-col gap-1 text-sm text-ink">
                  {t.lines.map((l) => (
                    <li key={l.itemId}>
                      <strong className="tabular-nums">{l.quantity}×</strong> {l.itemName}
                      {l.notes && <span className="block pl-5 text-xs text-ink-muted">Obs.: {l.notes}</span>}
                    </li>
                  ))}
                </ul>
                {canAct && (
                  <button type="button" disabled={advance.isPending} onClick={() => advance.mutate(t)} className={`${primary} mt-auto`}>{nextLabel(t)}</button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
