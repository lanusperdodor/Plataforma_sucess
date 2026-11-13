import { Bike, Settings, Store, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { OrdersTab } from '../merchant/OperationsTabs.tsx'
import { useGestao } from './context.ts'
import { SectionTitle } from './ui.tsx'

const MODE: Record<'partner' | 'own' | 'none', { title: string; text: string }> = {
  partner: { title: 'Entregador parceiro Tucaí', text: 'Um entregador da Tucaí busca o pedido na sua loja quando ele estiver pronto.' },
  own: { title: 'Entregador da sua loja', text: 'Você escolhe um entregador da sua equipe para cada pedido.' },
  none: { title: 'Sem entrega (só retirada)', text: 'Os clientes buscam o pedido na loja.' },
}

/** Entregas da loja: como a loja entrega e os pedidos de entrega (em andamento e concluídos). */
export function DeliveriesTab() {
  const { business: b, can } = useGestao()
  const mode = MODE[b.deliveryOffer]
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title="Entregas" subtitle="Acompanhe os pedidos que saem para entrega." />
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-ink">{b.deliveryOffer === 'own' ? <Store className="size-5" /> : <Bike className="size-5" />}</span>
          <div>
            <p className="text-sm text-ink-muted">Como sua loja entrega</p>
            <p className="font-semibold text-ink">{mode.title}</p>
            <p className="text-sm text-ink-muted">{mode.text}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('store.customize') && (
            <Link to={`/painel/${b.id}/loja`} className="pressable inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-ink"><Settings aria-hidden="true" className="size-4" />Mudar forma de entrega</Link>
          )}
          {can('staff.manage') && b.deliveryOffer === 'own' && (
            <Link to={`/painel/${b.id}/equipe`} className="pressable inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-ink"><Users aria-hidden="true" className="size-4" />Entregadores da loja</Link>
          )}
        </div>
      </div>
      <OrdersTab businessId={b.id} canUpdate={can('orders.update_status')} onlyDelivery />
    </div>
  )
}
