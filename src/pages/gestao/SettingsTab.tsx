import { useMutation } from '@tanstack/react-query'
import { Check, Crown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/feedback/toast-context.ts'
import { requestPlanChange } from '../../features/gestao/repository.ts'
import { PlanTab } from '../merchant/OperationsTabs.tsx'
import { useGestao } from './context.ts'
import { box, msg, primary, secondary, SectionTitle } from './ui.tsx'

const PLANS = [
  {
    code: 'delivery' as const,
    name: 'Padrão',
    price: 'R$ 79/mês',
    items: ['Loja e cardápio na Tucaí', 'Pedidos de delivery e retirada', 'Cozinha/separação dos pedidos', 'Vendas e visão geral', 'Equipe com cargos'],
  },
  {
    code: 'presencial_delivery' as const,
    name: 'Premium',
    price: 'R$ 99/mês',
    items: ['Tudo do Padrão', 'Comandas e mesas', 'Caixa presencial com fechamento', 'QR das mesas', 'Controle de gastos e Meu Lucro', 'Calculadora de custos e preço sugerido', 'Relatórios avançados'],
  },
]

/** Configurações: plano (comparativo, solicitação de troca e cobranças) e atalhos de cadastro. */
export function SettingsTab() {
  const { business: b, plan, can } = useGestao()
  const toast = useToast()
  const ask = useMutation({
    mutationFn: (code: 'delivery' | 'presencial_delivery') => requestPlanChange(b.id, code),
    onSuccess: () => toast.success('Pedido enviado. A equipe Tucaí entra em contato para confirmar a troca — nenhuma cobrança é feita automaticamente.'),
    onError: (e) => toast.error(msg(e)),
  })
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title="Configurações" subtitle="Plano, cobranças e dados do estabelecimento." />
      <section className={box} aria-labelledby="plano-atual">
        <h2 id="plano-atual" className="text-base font-semibold text-ink">Plano atual</h2>
        <p className="mt-1 text-sm text-ink">
          {plan?.name ? <><strong>{plan.name}</strong>{plan.source === 'homologacao' ? ' — liberado para homologação (sem cobrança)' : plan.periodEnd ? ` — vigente até ${plan.periodEnd.split('-').reverse().join('/')}` : ''}</> : 'Nenhum plano ativo.'}
        </p>
      </section>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {PLANS.map((p) => {
          const current = plan?.code === p.code
          return (
            <section key={p.code} className={`${box} flex flex-col gap-3`} aria-labelledby={`plano-${p.code}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 id={`plano-${p.code}`} className="flex items-center gap-1.5 text-lg font-bold text-ink">{p.code === 'presencial_delivery' && <Crown aria-hidden="true" className="size-4" />}{p.name}</h3>
                <span className="text-sm font-semibold text-ink">{p.price}</span>
              </div>
              <ul className="flex flex-col gap-1 text-sm text-ink">
                {p.items.map((i) => <li key={i} className="flex gap-2"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />{i}</li>)}
              </ul>
              {current ? (
                <span className="mt-auto w-fit rounded-full bg-muted px-3 py-1 text-sm font-semibold text-ink">Seu plano</span>
              ) : can('settings.manage') ? (
                <button type="button" disabled={ask.isPending} onClick={() => ask.mutate(p.code)} className={`${p.code === 'presencial_delivery' ? primary : secondary} mt-auto w-fit`}>Solicitar {p.name}</button>
              ) : (
                <p className="mt-auto text-xs text-ink-muted">Somente o proprietário solicita a troca de plano.</p>
              )}
            </section>
          )
        })}
      </div>
      <PlanTab businessId={b.id} />
      {can('store.customize') && (
        <p className="text-sm text-ink">Dados, endereço, entrega e fotos ficam em <Link to={`/painel/${b.id}/loja`} className="font-semibold underline">Minha loja</Link>.</p>
      )}
    </div>
  )
}
