import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import {
  EXPENSE_CATEGORIES,
  addExpense,
  deleteExpense,
  getMerchantFinance,
  listExpenses,
  listProductCosts,
  setProductCost,
  type ExpenseCategory,
  type MerchantFinance,
} from '../../features/merchant/repository.ts'
import { formatBRL } from '../../lib/money.ts'

const box = 'rounded-card border border-line bg-surface p-4 md:p-6'
const field = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink'
const primary = 'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-surface disabled:opacity-50'
const secondary = 'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink disabled:opacity-50'
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Algo deu errado. Tente novamente.')
/** Valor com sinal (lucro pode ser negativo). */
const money = (c: number) => (c < 0 ? `− ${formatBRL(Math.round(-c))}` : formatBRL(Math.round(c)))
const PAY: Record<string, string> = { cash: 'Dinheiro', pix_on_delivery: 'Pix na entrega', card_on_delivery: 'Cartão na entrega' }

const pad = (n: number) => String(n).padStart(2, '0')
const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function monthRange(): { from: string; to: string } {
  const now = new Date()
  return { from: localIso(new Date(now.getFullYear(), now.getMonth(), 1)), to: localIso(now) }
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-lg font-bold tabular-nums text-ink">{value}</dd>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}

function Period({ value, onChange }: { value: { from: string; to: string }; onChange: (v: { from: string; to: string }) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-sm font-medium text-ink">De<input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className={field} /></label>
      <label className="text-sm font-medium text-ink">Até<input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} className={field} /></label>
    </div>
  )
}

/** Resultado = vendas − custo dos produtos − taxas Tucaí − despesas. Estimado: avisa quando faltam custos. */
export function profitOf(f: MerchantFinance) {
  const taxas = f.comissao_cents + f.taxas_entrega_cents
  const receitaLiquida = f.faturamento_bruto_cents - taxas
  const margemBruta = f.vendas_itens_com_custo_cents - f.custo_produtos_cents
  const resultado = receitaLiquida - f.custo_produtos_cents - f.despesas_cents
  return { taxas, receitaLiquida, margemBruta, resultado, completo: f.itens_sem_custo === 0 }
}

// ---------- Caixa / painel do dia e do mês ----------
export function CashTab({ businessId }: { businessId: string }) {
  const [range, setRange] = useState(monthRange)
  const q = useQuery({ queryKey: ['merchant', 'finance', businessId, range], queryFn: () => getMerchantFinance(businessId, range.from, range.to), refetchInterval: 60_000 })
  const f = q.data
  return (
    <div className={`${box} flex flex-col gap-4`}>
      <Period value={range} onChange={setRange} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !f ? <p role="status" className="text-sm text-ink-muted">Carregando…</p> : (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Vendido hoje" value={formatBRL(f.hoje_cents)} />
            <Stat label="Vendido no mês" value={formatBRL(f.mes_cents)} />
            <Stat label="Pedidos concluídos (período)" value={String(f.pedidos)} />
            <Stat label="Ticket médio" value={f.pedidos ? formatBRL(f.ticket_medio_cents) : '—'} />
            <Stat label="Cancelados/recusados" value={String(f.cancelados)} />
            <Stat label="Líquido estimado" value={money(profitOf(f).receitaLiquida)} hint="Vendas − taxas Tucaí" />
            <Stat label="Recebido na entrega/retirada" value={formatBRL(f.recebido_na_entrega_cents)} hint="Pedidos pagos direto à loja" />
          </dl>
          <div>
            <h3 className="mb-2 text-base font-semibold text-ink">Caixa de hoje por forma de pagamento</h3>
            {Object.keys(f.caixa_hoje).length === 0 ? <p className="text-sm text-ink-muted">Nenhum pedido concluído hoje.</p> : (
              <ul className="divide-y divide-line text-sm">
                {Object.entries(f.caixa_hoje).map(([k, v]) => <li key={k} className="flex justify-between py-2"><span>{PAY[k] ?? k}</span><span className="font-semibold tabular-nums">{formatBRL(v)}</span></li>)}
              </ul>
            )}
          </div>
          <p className="text-xs text-ink-muted">Pedidos com entregador parceiro em dinheiro: o valor é recebido pelo entregador e repassado à loja; confira o repasse antes de fechar o caixa.</p>
        </>
      )}
    </div>
  )
}

// ---------- Controle de gastos ----------
export function ExpensesTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['merchant', 'expenses', businessId], queryFn: () => listExpenses(businessId) })
  const [form, setForm] = useState({ category: 'mercadorias' as ExpenseCategory, description: '', amount: '', spentOn: localIso(new Date()), recurrence: 'unica' as 'unica' | 'mensal' })
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['merchant', 'expenses', businessId] }); void qc.invalidateQueries({ queryKey: ['merchant', 'finance', businessId] }) }
  const add = useMutation({
    mutationFn: () => addExpense(businessId, form),
    onSuccess: () => { toast.success('Gasto registrado.'); setForm((f) => ({ ...f, description: '', amount: '' })); refresh() },
    onError: (e) => toast.error(msg(e)),
  })
  const del = useMutation({ mutationFn: deleteExpense, onSuccess: () => { toast.success('Gasto removido.'); refresh() }, onError: (e) => toast.error(msg(e)) })
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate() }
  const rows = q.data ?? []
  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className={`${box} grid gap-3 sm:grid-cols-2 lg:grid-cols-6`}>
        <label className="text-sm font-medium text-ink lg:col-span-2">Categoria
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })} className={field}>
            {Object.entries(EXPENSE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-ink lg:col-span-2">Descrição<input value={form.description} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} className={field} /></label>
        <label className="text-sm font-medium text-ink">Valor (R$)<input inputMode="decimal" placeholder="150,00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={field} /></label>
        <label className="text-sm font-medium text-ink">Data<input type="date" value={form.spentOn} onChange={(e) => setForm({ ...form, spentOn: e.target.value })} className={field} /></label>
        <label className="text-sm font-medium text-ink lg:col-span-2">Recorrência
          <select value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value as 'unica' | 'mensal' })} className={field}>
            <option value="unica">Única</option><option value="mensal">Todo mês (a partir desta data)</option>
          </select>
        </label>
        <div className="flex items-end"><button type="submit" disabled={add.isPending} className={primary}>{add.isPending ? 'Salvando…' : 'Registrar gasto'}</button></div>
      </form>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{q.isLoading ? 'Carregando…' : 'Nenhum gasto registrado ainda.'}</p>
      ) : (
        <ul className={`${box} divide-y divide-line text-sm`}>
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-ink">{EXPENSE_CATEGORIES[r.category] ?? r.category}{r.description ? ` · ${r.description}` : ''}
                <span className="block text-xs text-ink-muted">{new Date(`${r.spentOn}T12:00:00`).toLocaleDateString('pt-BR')}{r.recurrence === 'mensal' ? ' · todo mês' : ''}</span></span>
              <span className="flex items-center gap-2">
                <strong className="tabular-nums">{formatBRL(r.amountCents)}</strong>
                <button type="button" aria-label={`Remover gasto ${EXPENSE_CATEGORIES[r.category] ?? r.category}`} disabled={del.isPending}
                  onClick={() => { if (window.confirm('Remover este gasto?')) del.mutate(r.id) }} className={secondary}><Trash2 aria-hidden="true" className="size-4" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Meu lucro ----------
export function ProfitTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [range, setRange] = useState(monthRange)
  const fin = useQuery({ queryKey: ['merchant', 'finance', businessId, range], queryFn: () => getMerchantFinance(businessId, range.from, range.to) })
  const costs = useQuery({ queryKey: ['merchant', 'costs', businessId], queryFn: () => listProductCosts(businessId) })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: (a: { id: string; value: string }) => setProductCost(businessId, a.id, a.value),
    onSuccess: () => { toast.success('Custo salvo.'); void qc.invalidateQueries({ queryKey: ['merchant', 'costs', businessId] }); void qc.invalidateQueries({ queryKey: ['merchant', 'finance', businessId] }) },
    onError: (e) => toast.error(msg(e)),
  })
  const f = fin.data
  const p = f ? profitOf(f) : null
  return (
    <div className="flex flex-col gap-3">
      <div className={`${box} flex flex-col gap-4`}>
        <Period value={range} onChange={setRange} />
        {fin.isError ? <ErrorState error={fin.error} onRetry={() => void fin.refetch()} /> : !f || !p ? <p role="status" className="text-sm text-ink-muted">Carregando…</p> : (
          <>
            {!p.completo && (
              <p role="status" className="flex items-start gap-2 rounded-xl bg-orange/15 p-3 text-sm text-ink">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {f.itens_sem_custo} item(ns) vendido(s) sem custo cadastrado. O lucro abaixo é uma estimativa incompleta: cadastre o custo dos produtos.
              </p>
            )}
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Stat label="Faturamento bruto" value={formatBRL(f.faturamento_bruto_cents)} hint="Produtos + entrega própria" />
              <Stat label="Taxas Tucaí" value={`− ${formatBRL(p.taxas)}`} hint="Comissão e logística" />
              <Stat label="Receita líquida" value={money(p.receitaLiquida)} />
              <Stat label="Custo dos produtos" value={`− ${formatBRL(f.custo_produtos_cents)}`} />
              <Stat label="Margem bruta" value={money(p.margemBruta)} hint="Só itens com custo" />
              <Stat label="Despesas operacionais" value={`− ${formatBRL(f.despesas_cents)}`} />
            </dl>
            <div className="rounded-xl border border-line p-3">
              <p className="text-sm text-ink-muted">Lucro estimado no período {p.completo ? '' : '(incompleto)'}</p>
              <p className={`text-2xl font-bold tabular-nums ${p.resultado < 0 ? 'text-danger' : 'text-ink'}`}>{money(p.resultado)}</p>
              <p className="text-xs text-ink-muted">Receita líquida − custo dos produtos − despesas. Valores liquidados: pedidos pagos na entrega entram no seu caixa na hora; a parte da Tucaí é cobrada à parte (aba Plano).</p>
            </div>
          </>
        )}
      </div>
      <div className={`${box} flex flex-col gap-2`}>
        <h3 className="text-base font-semibold text-ink">Custo de cada produto</h3>
        <p className="text-xs text-ink-muted">Só a equipe da loja com acesso a relatórios vê estes custos; o cliente nunca vê.</p>
        {costs.isError ? <ErrorState error={costs.error} onRetry={() => void costs.refetch()} /> : (
          <ul className="divide-y divide-line text-sm">
            {(costs.data ?? []).map((c) => {
              const draft = drafts[c.productId] ?? (c.costCents === null ? '' : (c.costCents / 100).toFixed(2).replace('.', ','))
              const margin = c.costCents !== null && c.priceCents > 0 ? Math.round(((c.priceCents - c.costCents) / c.priceCents) * 100) : null
              return (
                <li key={c.productId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-ink">{c.name}<span className="block text-xs text-ink-muted">Venda {formatBRL(c.priceCents)}{margin !== null ? ` · margem ${margin}%` : ' · sem custo'}</span></span>
                  <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ id: c.productId, value: draft }) }}>
                    <label className="sr-only" htmlFor={`cost-${c.productId}`}>Custo de {c.name}</label>
                    <input id={`cost-${c.productId}`} inputMode="decimal" placeholder="custo" value={draft} onChange={(e) => setDrafts((d) => ({ ...d, [c.productId]: e.target.value }))} className={`${field} w-28`} />
                    <button type="submit" disabled={save.isPending} className={secondary}>Salvar</button>
                  </form>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
