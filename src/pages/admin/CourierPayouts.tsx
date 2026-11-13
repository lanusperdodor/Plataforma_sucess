import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Bike, Store, User, Wallet } from 'lucide-react'
import { useState } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { decideWithdrawal, getDeliveryMoney, listCourierWithdrawals } from '../../features/admin/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { errorMessage, formatDateTime, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const LABEL = { solicitado: 'Em análise', pago: 'Pago', recusado: 'Recusado', cancelado: 'Cancelado' } as const

function Flow({ label, value, icon: Icon, tone, sign }: { label: string; value: number; icon: typeof Wallet; tone: string; sign?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="size-5" /></span>
      <div className="min-w-0">
        <p className="text-xs text-ink-muted">{label}</p>
        <p className="text-lg font-bold tabular-nums text-ink">{sign}{formatBRL(value)}</p>
      </div>
    </div>
  )
}

/** Entregas do período: quem pagou, quem recebeu e quanto fica com a Tucaí; pedidos de saque dos entregadores. */
export function CourierPayouts({ canDecide }: { canDecide: boolean }) {
  const today = new Date()
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [to, setTo] = useState(iso(today))
  const [includeTest, setIncludeTest] = useState(true)
  const [status, setStatus] = useState<'solicitado' | 'pago' | 'recusado' | 'todos'>('solicitado')
  const qc = useQueryClient()
  const toast = useToast()
  const money = useQuery({ queryKey: ['admin', 'delivery-money', from, to, includeTest], queryFn: () => getDeliveryMoney(from, to, includeTest) })
  const list = useQuery({ queryKey: ['admin', 'withdrawals', status], queryFn: () => listCourierWithdrawals(status) })
  const decide = useMutation({
    mutationFn: (a: { id: string; decision: 'pago' | 'recusado'; note?: string }) => decideWithdrawal(a.id, a.decision, a.note),
    onSuccess: (_, a) => { toast.success(a.decision === 'pago' ? 'Saque marcado como pago. O entregador foi avisado.' : 'Saque recusado; o valor voltou ao saldo do entregador.'); void qc.invalidateQueries({ queryKey: ['admin'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const m = money.data
  return (
    <section aria-labelledby="entregas-dinheiro" className="flex flex-col gap-3">
      <h2 id="entregas-dinheiro" className="flex items-center gap-2 text-lg font-bold text-ink">
        <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-muted text-ink"><Bike className="size-4" /></span>
        Entregas: quem pagou e quem recebeu
      </h2>
      <div className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface p-3">
        <label className="text-sm font-medium text-ink">De<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} /></label>
        <label className="text-sm font-medium text-ink">Até<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} /></label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink"><input type="checkbox" className="size-4" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />Incluir pedidos de teste</label>
      </div>
      {money.isError ? <ErrorState error={money.error} onRetry={() => void money.refetch()} /> : !m ? <p role="status" className="text-sm text-ink-muted">Carregando…</p> : (
        <>
          <p className="text-sm text-ink-muted">
            {m.entregas_parceiras} {m.entregas_parceiras === 1 ? 'entrega parceira concluída' : 'entregas parceiras concluídas'}
            {m.pedidos_teste > 0 ? ` (${m.pedidos_teste} de teste)` : ''}. Em cada uma: cliente paga a taxa + estabelecimento contribui = entregador recebe + Tucaí recebe.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Flow label="Clientes pagaram (taxa de entrega)" value={m.clientes_pagaram_cents} icon={User} tone="bg-muted text-ink" />
            <Flow label="Estabelecimentos contribuíram" value={m.lojas_pagaram_cents} icon={Store} tone="bg-muted text-ink" sign="+ " />
            <Flow label="Entregadores ganharam" value={m.entregadores_ganharam_cents} icon={Bike} tone="bg-muted text-ink" sign="= " />
            <Flow label="Tucaí recebe (entregas parceiras)" value={m.tucai_parceiras_cents} icon={Wallet} tone="bg-muted text-ink" sign="+ " />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Flow label={`Tucaí recebe (${m.entregas_proprias} entregas próprias das lojas)`} value={m.tucai_proprias_cents} icon={Store} tone="bg-muted text-ink" />
            <Flow label="Saques pagos no período" value={m.saques_pagos_cents} icon={Banknote} tone="bg-muted text-ink" />
            <Flow label={`Saques em análise (${m.saques_em_analise})`} value={m.saques_em_analise_cents} icon={Wallet} tone="bg-muted text-ink" />
            <Flow label="Saldo dos entregadores (a pagar)" value={m.saldo_entregadores_cents} icon={Bike} tone="bg-muted text-ink" />
          </div>
        </>
      )}
      <Panel className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-ink">Pedidos de saque</h3>
          <select aria-label="Situação dos saques" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={`${inputClass} w-auto`}>
            <option value="solicitado">Em análise</option><option value="pago">Pagos</option><option value="recusado">Recusados</option><option value="todos">Todos</option>
          </select>
        </div>
        <p className="text-xs text-ink-muted">Cada entrega fica guardada 7 dias na carteira do entregador antes de poder ser sacada. Transfira pelo Pix informado e marque como pago.</p>
        {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : (list.data ?? []).length === 0 ? (
          <p className="text-ink-muted">{list.isLoading ? 'Carregando…' : 'Nenhum saque nesta situação.'}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(list.data ?? []).map((w) => (
              <li key={w.id} className="flex flex-col gap-2 rounded-xl border border-line p-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{w.courierName}{w.isTest ? ' · teste' : ''} — {formatBRL(w.amountCents)}</p>
                  <p className="text-ink-muted">Pix: <span className="font-mono text-ink">{w.pixKey}</span> · pedido em {formatDateTime(w.requestedAt)}</p>
                  <p className="text-xs text-ink-muted">{LABEL[w.status]}{w.note ? ` · ${w.note}` : ''} · ainda guardado: {formatBRL(w.heldCents)}</p>
                </div>
                {w.status === 'solicitado' && canDecide && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={decide.isPending} onClick={() => { if (window.confirm(`Confirmar que ${formatBRL(w.amountCents)} já foram transferidos para ${w.courierName}?`)) decide.mutate({ id: w.id, decision: 'pago' }) }} className={primaryButton}>Marcar como pago</button>
                    <button type="button" disabled={decide.isPending} onClick={() => { const note = window.prompt('Motivo da recusa (o entregador verá):'); if (note) decide.mutate({ id: w.id, decision: 'recusado', note }) }} className={secondaryButton}>Recusar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  )
}
