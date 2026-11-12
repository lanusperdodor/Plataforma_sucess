import { CashTab } from '../merchant/MerchantFinance.tsx'
import { SalesTab } from '../merchant/OperationsTabs.tsx'
import { useGestao } from './context.ts'
import { PremiumUpsell, SectionTitle } from './ui.tsx'

/** Relatórios: vendas (todos os planos) e fluxo de recebimentos/gastos por período (Premium). */
export function ReportsTab() {
  const { business: b, premium } = useGestao()
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title="Relatórios" subtitle="Números calculados no servidor a partir de pedidos, comandas e lançamentos reais." />
      <section aria-labelledby="rel-vendas" className="flex flex-col gap-3">
        <h2 id="rel-vendas" className="text-base font-semibold text-ink">Vendas</h2>
        <SalesTab businessId={b.id} />
      </section>
      <section aria-labelledby="rel-fluxo" className="flex flex-col gap-3">
        <h2 id="rel-fluxo" className="text-base font-semibold text-ink">Recebimentos e gastos por período</h2>
        {premium ? <CashTab businessId={b.id} /> : <PremiumUpsell businessId={b.id} feature="Relatórios avançados" />}
      </section>
    </div>
  )
}
