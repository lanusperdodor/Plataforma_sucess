import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Receipt, Search } from 'lucide-react'
import { useState } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { FilterChips } from '../../components/nav/FilterChips.tsx'
import { paymentsPage } from '../../features/admin/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { formatDateTime, inputClass, Pager, Panel, primaryButton } from './ui.tsx'

const STATUS = [{ value: '', label: 'Todas' }, { value: 'aberta', label: 'Em aberto' }, { value: 'paga', label: 'Pagas' }, { value: 'cancelada', label: 'Canceladas' }] as const
const ORIGIN = [{ value: 'todos', label: 'Qualquer origem' }, { value: 'online', label: 'Confirmadas pelo Mercado Pago' }, { value: 'manual', label: 'Manuais / em aberto' }] as const
const EVENT: Record<string, string> = {
  'finance.charge': 'Cobrança gerada', 'finance.paid': 'Baixa manual', 'finance.charge_cancel': 'Cancelada', 'payments.confirmed': 'Confirmada pelo Mercado Pago',
}

/** Transações reais da plataforma (cobranças), com conciliação: só conta como paga o que o provedor confirmou ou a baixa manual registrada. */
export function PaymentsHistory() {
  const [status, setStatus] = useState('')
  const [origin, setOrigin] = useState<'todos' | 'online' | 'manual'>('todos')
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [page, setPage] = useState(1)
  const q = useQuery({ queryKey: ['admin', 'payments', status, origin, term, page], queryFn: () => paymentsPage(status, term, origin, page), placeholderData: keepPreviousData })
  const rows = q.data ?? []
  return (
    <section aria-labelledby="transacoes" className="flex flex-col gap-3">
      <h2 id="transacoes" className="flex items-center gap-2 text-lg font-bold text-ink"><Receipt aria-hidden="true" className="size-5" />Transações</h2>
      <Panel className="flex flex-col gap-3 text-sm">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setTerm(search) }}>
          <label className="min-w-56 flex-1 font-medium text-ink">Estabelecimento, descrição ou ID do pagamento
            <span className="relative block">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} pl-9`} />
            </span>
          </label>
          <button type="submit" className={primaryButton}>Buscar</button>
        </form>
        <FilterChips label="Situação" options={STATUS.map((s) => ({ value: s.value, label: s.label }))} value={status} onChange={(v) => { setPage(1); setStatus(v) }} />
        <FilterChips label="Origem" options={ORIGIN.map((s) => ({ value: s.value, label: s.label }))} value={origin} onChange={(v) => { setPage(1); setOrigin(v as typeof origin) }} />
        <p className="text-xs text-ink-muted">
          Pedidos dos clientes são pagos na entrega (dinheiro, Pix ou maquininha do estabelecimento) e não passam por aqui. Estornos e reembolsos são feitos na conta do
          Mercado Pago; a Tucaí ainda não recebe o aviso de estorno, então nenhum estorno é marcado sem confirmação do provedor.
        </p>
      </Panel>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <Panel className="text-sm text-ink-muted">{q.isLoading ? 'Carregando…' : 'Nenhuma transação com estes filtros.'}</Panel>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((p) => (
              <li key={p.id}>
                <Panel className="flex flex-col gap-1 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{p.business} · {p.description}</span>
                    <span className="font-bold tabular-nums text-ink">{formatBRL(p.amountCents)}</span>
                  </div>
                  <p className="text-ink-muted">
                    {p.status === 'paga' ? `Paga em ${p.paidAt ? formatDateTime(p.paidAt) : '—'} · ${p.provider === 'mercadopago' ? `Mercado Pago (ID ${p.providerPaymentId})` : `baixa manual (${p.paidMethod ?? '—'})`}`
                      : p.status === 'aberta' ? `Em aberto · vence em ${new Date(`${p.dueOn}T12:00:00`).toLocaleDateString('pt-BR')}` : 'Cancelada'}
                  </p>
                  {p.events.length > 0 && (
                    <p className="text-xs text-ink-muted">Eventos: {p.events.map((e) => `${EVENT[e.action] ?? e.action} (${formatDateTime(e.at)})`).join(' → ')}</p>
                  )}
                </Panel>
              </li>
            ))}
          </ul>
          <Pager page={page} pageSize={30} total={rows[0]?.total ?? 0} onPage={setPage} loading={q.isFetching} />
        </>
      )}
    </section>
  )
}
