import { Check, LifeBuoy, Receipt, RotateCcw, Store } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { LoginInvite } from '../components/feedback/LoginInvite.tsx'
import { useToast } from '../components/feedback/toast-context.ts'
import { FilterChips } from '../components/nav/FilterChips.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { DEMO_ORDERS, ORDER_STAGES, type DemoOrder } from '../features/demo/preview-data.ts'
import { formatBRL } from '../lib/money.ts'

function Stepper({ stage }: { stage: DemoOrder['stage'] }) {
  const current = ORDER_STAGES.findIndex((s) => s.id === stage)
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label="Etapas do pedido">
      {ORDER_STAGES.map((s, i) => (
        <li key={s.id} aria-current={i === current ? 'step' : undefined} className="flex flex-col gap-1">
          <span className={`h-1.5 rounded-full ${i <= current ? 'bg-orange' : 'bg-muted'}`} />
          <span className={`text-[0.6875rem] ${i === current ? 'font-bold text-ink' : 'text-ink-muted'}`}>{s.label}</span>
        </li>
      ))}
    </ol>
  )
}

function OrderCard({ order, onAction }: { order: DemoOrder; onAction: () => void }) {
  const active = order.stage !== 'entregue' && order.stage !== 'cancelado'
  return (
    <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-orange">
          <Store className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-ink">{order.businessName}</h3>
          <p className="truncate text-xs text-ink-muted">{order.items}</p>
          <p className="text-xs text-ink-muted">{order.whenLabel}</p>
        </div>
        <span className="text-sm font-bold text-ink">{formatBRL(order.totalCents)}</span>
      </div>
      {active ? (
        <Stepper stage={order.stage} />
      ) : (
        <p className="inline-flex items-center gap-1 text-sm font-semibold text-success">
          <Check aria-hidden="true" className="size-4" />
          Entregue
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onAction} className="pressable inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink">
          {active ? 'Acompanhar' : <><RotateCcw aria-hidden="true" className="size-4" />Repetir</>}
        </button>
        <button type="button" onClick={onAction} aria-label="Ajuda com o pedido" className="pressable inline-flex size-11 items-center justify-center rounded-full border border-line text-ink-muted">
          <LifeBuoy aria-hidden="true" className="size-4" />
        </button>
      </div>
    </article>
  )
}

/** Pedidos: em andamento e anteriores. Sem backend de pedidos ainda: mostra exemplos rotulados. */
export function OrdersPage() {
  const { session } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState<'andamento' | 'anteriores'>('andamento')
  const examples = DEMO_ORDERS.filter((o) => (tab === 'andamento' ? o.stage !== 'entregue' : o.stage === 'entregue'))
  const demoOnly = () => toast.info('Pedido de exemplo: nada foi enviado.')

  return (
    <Page>
      <PageHeader icon={Receipt} title="Pedidos" subtitle="Acompanhe e repita seus pedidos." />
      {!session ? (
        <LoginInvite icon={Receipt} title="Seus pedidos ficam aqui" description="Entre para acompanhar entregas." />
      ) : (
        <EmptyState icon={Receipt} title="Você ainda não fez pedidos" description="Quando pedir, ele aparece aqui." action={<Link to="/restaurantes" className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">Ver restaurantes</Link>} />
      )}
      <FilterChips label="Situação" options={[{ value: 'andamento', label: 'Em andamento' }, { value: 'anteriores', label: 'Anteriores' }]} value={tab} onChange={setTab} />
      <section aria-label="Exemplos de pedidos" className="flex flex-col gap-2">
        <p className="text-xs text-ink-muted">Exemplos de como seus pedidos aparecem.</p>
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {examples.map((o) => (
            <li key={o.id}>
              <OrderCard order={o} onAction={demoOnly} />
            </li>
          ))}
        </ul>
      </section>
    </Page>
  )
}