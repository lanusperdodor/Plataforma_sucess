import { Bike, Settings, Store, Users } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/feedback/toast-context.ts'
import { getFreeDelivery, setFreeDelivery } from '../../features/gestao/repository.ts'
import { OrdersTab } from '../merchant/OperationsTabs.tsx'
import { useGestao } from './context.ts'
import { StoreLocationCard } from './StoreLocationCard.tsx'
import { SectionTitle } from './ui.tsx'

const MODE: Record<'partner' | 'own' | 'none', { title: string; text: string }> = {
  partner: { title: 'Entregador parceiro Tucaí', text: 'Um entregador da Tucaí busca o pedido na sua loja quando ele estiver pronto.' },
  own: { title: 'Entregador da sua loja', text: 'Você escolhe um entregador da sua equipe para cada pedido.' },
  none: { title: 'Sem entrega (só retirada)', text: 'Os clientes buscam o pedido na loja.' },
}

/** Promoção de frete grátis: o cliente paga R$ 0 e a loja paga a entrega inteira (o entregador recebe o mesmo valor). */
function FreeDeliveryToggle({ businessId }: { businessId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['gestao', 'free-delivery', businessId], queryFn: () => getFreeDelivery(businessId) })
  const change = useMutation({
    mutationFn: (on: boolean) => setFreeDelivery(businessId, on),
    onSuccess: (_v, on) => { toast.success(on ? 'Frete grátis ligado.' : 'Frete grátis desligado.'); void qc.invalidateQueries({ queryKey: ['gestao', 'free-delivery', businessId] }) },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível alterar.'),
  })
  if (q.data === null || q.data === undefined) return null
  return (
    <label className="flex items-start gap-3 rounded-card border border-line bg-surface p-4">
      <input type="checkbox" className="mt-1 size-5" checked={q.data} disabled={change.isPending} onChange={(e) => change.mutate(e.target.checked)} />
      <span>
        <span className="block font-semibold text-ink">Frete grátis para os clientes</span>
        <span className="block text-sm text-ink-muted">O cliente não paga entrega e sua loja assume o valor inteiro da corrida (ganho do entregador + R$ 1 da Tucaí), cobrado no fechamento do mês.</span>
      </span>
    </label>
  )
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
      {can('store.customize') && <StoreLocationCard businessId={b.id} />}
      {b.deliveryOffer === 'partner' && can('store.customize') && <FreeDeliveryToggle businessId={b.id} />}
      <OrdersTab businessId={b.id} canUpdate={can('orders.update_status')} onlyDelivery />
    </div>
  )
}
