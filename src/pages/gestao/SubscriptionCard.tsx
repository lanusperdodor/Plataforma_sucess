import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CreditCard } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '../../components/feedback/toast-context.ts'
import { cancelSubscription, getGatewaySubscription, startSubscription } from '../../features/payments/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { PLANS, type PlanCode } from './plans.ts'

const STATUS: Record<string, { text: string; tone: string }> = {
  pendente: { text: 'Aguardando você autorizar o cartão no Mercado Pago', tone: 'text-ink' },
  autorizada: { text: 'Ativo: o Mercado Pago cobra todo mês automaticamente', tone: 'text-success' },
  pausada: { text: 'Pausado no Mercado Pago (cartão recusado ou pausa)', tone: 'text-danger' },
  cancelada: { text: 'Cancelado', tone: 'text-ink-muted' },
}

/** Débito automático do plano (Mercado Pago Assinaturas). Só o dono/gestor com configurações. */
export function SubscriptionCard({ businessId, currentPlan }: { businessId: string; currentPlan?: string | null }) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['assinatura', businessId], queryFn: () => getGatewaySubscription(businessId) })
  const [plan, setPlan] = useState<PlanCode>(currentPlan === 'presencial_delivery' ? 'presencial_delivery' : 'delivery')
  const start = useMutation({
    mutationFn: () => startSubscription(businessId, plan),
    onSuccess: (url) => { window.location.assign(url) },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível iniciar a assinatura.'),
  })
  const cancel = useMutation({
    mutationFn: () => cancelSubscription(businessId),
    onSuccess: () => { toast.success('Débito automático cancelado.'); void qc.invalidateQueries({ queryKey: ['assinatura', businessId] }) },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível cancelar.'),
  })
  const s = q.data
  const active = s && (s.status === 'autorizada' || s.status === 'pausada')
  return (
    <section aria-labelledby="debito-auto" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:p-5">
      <h2 id="debito-auto" className="flex items-center gap-2 text-base font-semibold text-ink"><CreditCard aria-hidden="true" className="size-5" />Débito automático do plano</h2>
      {s && (
        <p className={`text-sm font-semibold ${STATUS[s.status]?.tone ?? ''}`}>
          {PLANS.find((p) => p.code === s.planCode)?.name ?? s.planCode} · {formatBRL(s.priceCents)}/mês — {STATUS[s.status]?.text}
          {s.lastPaymentAt ? ` · última cobrança em ${new Date(s.lastPaymentAt).toLocaleDateString('pt-BR')}` : ''}
        </p>
      )}
      {active ? (
        <button type="button" disabled={cancel.isPending} onClick={() => { if (window.confirm('Cancelar o débito automático? O plano fica ativo até o fim do período já pago.')) cancel.mutate() }}
          className="pressable inline-flex min-h-11 w-fit items-center rounded-full border border-line px-4 text-sm font-semibold text-ink">
          {cancel.isPending ? 'Cancelando…' : 'Cancelar débito automático'}
        </button>
      ) : (
        <>
          <p className="text-sm text-ink-muted">Escolha o plano e autorize o cartão no Mercado Pago. A mensalidade é cobrada todo mês sozinha; você pode cancelar quando quiser.</p>
          <div role="radiogroup" aria-label="Plano" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PLANS.map((p) => (
              <label key={p.code} className={`pressable flex min-h-14 cursor-pointer items-center justify-between gap-2 rounded-2xl border-2 px-4 ${plan === p.code ? 'border-brand bg-muted' : 'border-line'}`}>
                <input type="radio" name={`plano-${businessId}`} className="sr-only" checked={plan === p.code} onChange={() => setPlan(p.code)} />
                <span className="font-semibold text-ink">{p.name}</span><span className="text-sm text-ink">{p.price}</span>
              </label>
            ))}
          </div>
          <button type="button" disabled={start.isPending} onClick={() => start.mutate()}
            className="pressable inline-flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-5 font-semibold text-surface disabled:opacity-60 sm:w-fit">
            {start.isPending ? 'Abrindo o Mercado Pago…' : 'Assinar com débito automático'}
          </button>
        </>
      )}
    </section>
  )
}
