import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calculator, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import {
  addIngredient, deleteIngredient, listCosting, listIngredients, listRecipe, saveCostingSnapshot, setProductExtras, setRecipeItem,
  type Costing, type Ingredient,
} from '../../features/gestao/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { useGestao } from './context.ts'
import { box, field, ghost, money, msg, parseCents, primary, secondary } from './ui.tsx'

const UNITS: Ingredient['unit'][] = ['un', 'kg', 'g', 'l', 'ml']
const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const num = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null }

function Ingredients() {
  const { business: b } = useGestao()
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['gestao', 'ingredients', b.id], queryFn: () => listIngredients(b.id) })
  const [f, setF] = useState({ name: '', unit: 'kg' as Ingredient['unit'], cost: '', qty: '1' })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['gestao'] })
  const add = useMutation({
    mutationFn: () => addIngredient(b.id, { name: f.name, unit: f.unit, purchaseCostCents: parseCents(f.cost) ?? 0, purchaseQty: num(f.qty) ?? 0 }),
    onSuccess: () => { toast.success('Insumo cadastrado.'); setF({ ...f, name: '', cost: '' }); refresh() },
    onError: (e) => toast.error(msg(e)),
  })
  const del = useMutation({ mutationFn: deleteIngredient, onSuccess: refresh, onError: (e) => toast.error(msg(e)) })
  return (
    <section className={box} aria-labelledby="insumos">
      <h3 id="insumos" className="mb-1 text-base font-semibold text-ink">Insumos</h3>
      <p className="mb-3 text-sm text-ink-muted">Informe quanto paga na compra (ex.: 1 kg de carne por R$ 42,00). O custo por unidade é calculado sozinho.</p>
      <form onSubmit={(e) => { e.preventDefault(); add.mutate() }} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_6rem_8rem_6rem_auto] sm:items-end">
        <label className="col-span-2 text-sm font-medium text-ink sm:col-span-1">Nome<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} className={`${field} mt-1`} /></label>
        <label className="text-sm font-medium text-ink">Unidade<select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as Ingredient['unit'] })} className={`${field} mt-1`}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="text-sm font-medium text-ink">Preço pago (R$)<input required value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} inputMode="decimal" className={`${field} mt-1`} /></label>
        <label className="text-sm font-medium text-ink">Quantidade<input required value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} inputMode="decimal" className={`${field} mt-1`} /></label>
        <button type="submit" disabled={add.isPending || !parseCents(f.cost) || !num(f.qty)} className={primary}>Adicionar</button>
      </form>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <ul className="mt-3 flex flex-col divide-y divide-line">
          {(q.data ?? []).map((i) => (
            <li key={i.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 text-ink">{i.name}</span>
              <span className="text-ink-muted tabular-nums">{formatBRL(i.purchaseCostCents)} / {i.purchaseQty.toLocaleString('pt-BR')} {i.unit}</span>
              <button type="button" onClick={() => { if (window.confirm(`Excluir ${i.name}?`)) del.mutate(i.id) }} className={ghost} aria-label={`Excluir ${i.name}`}><Trash2 aria-hidden="true" className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ProductCosting({ c, ingredients }: { c: Costing; ingredients: Ingredient[] }) {
  const { business: b } = useGestao()
  const qc = useQueryClient()
  const toast = useToast()
  const recipe = useQuery({ queryKey: ['gestao', 'recipe', c.productId], queryFn: () => listRecipe(c.productId) })
  const [extra, setExtra] = useState({
    packaging: (c.packagingCents / 100).toFixed(2).replace('.', ','),
    operational: (c.operationalCents / 100).toFixed(2).replace('.', ','),
    margin: String(c.targetMarginBps / 100).replace('.', ','),
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['gestao'] })
  const setQty = useMutation({
    mutationFn: (a: { ingredientId: string; qty: number | null }) => setRecipeItem(b.id, c.productId, a.ingredientId, a.qty),
    onSuccess: refresh,
    onError: (e) => toast.error(msg(e)),
  })
  const saveExtras = useMutation({
    mutationFn: () => setProductExtras(b.id, c.productId, {
      packagingCents: parseCents(extra.packaging) ?? 0, operationalCents: parseCents(extra.operational) ?? 0,
      targetMarginBps: Math.round((Number(extra.margin.replace(',', '.')) || 0) * 100),
    }),
    onSuccess: () => { toast.success('Custos atualizados.'); refresh() },
    onError: (e) => toast.error(msg(e)),
  })
  const snap = useMutation({ mutationFn: () => saveCostingSnapshot(b.id, c.productId), onSuccess: () => toast.success('Cálculo salvo no histórico.'), onError: (e) => toast.error(msg(e)) })
  const qtyOf = (id: string) => recipe.data?.find((r) => r.ingredientId === id)?.quantity
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <p className="text-sm font-semibold text-ink">Ficha técnica (quantidade por unidade vendida)</p>
      {ingredients.length === 0 ? <p className="text-sm text-ink-muted">Cadastre os insumos acima para montar a ficha.</p> : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ingredients.map((i) => (
            <li key={i.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-ink">{i.name}</span>
              <input
                aria-label={`Quantidade de ${i.name} em ${i.unit}`}
                defaultValue={qtyOf(i.id)?.toString().replace('.', ',') ?? ''}
                key={`${i.id}-${qtyOf(i.id) ?? ''}`}
                onBlur={(e) => {
                  const v = e.target.value.trim() ? num(e.target.value) : null
                  if (v !== (qtyOf(i.id) ?? null)) setQty.mutate({ ingredientId: i.id, qty: v })
                }}
                inputMode="decimal"
                placeholder="0"
                className="min-h-9 w-24 rounded-lg border border-line bg-surface px-2 text-right text-sm text-ink"
              />
              <span className="w-6 text-xs text-ink-muted">{i.unit}</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => { e.preventDefault(); saveExtras.mutate() }} className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-end">
        <label className="text-sm font-medium text-ink">Embalagem (R$)<input value={extra.packaging} onChange={(e) => setExtra({ ...extra, packaging: e.target.value })} inputMode="decimal" className={`${field} mt-1`} /></label>
        <label className="text-sm font-medium text-ink">Custo operacional (R$)<input value={extra.operational} onChange={(e) => setExtra({ ...extra, operational: e.target.value })} inputMode="decimal" className={`${field} mt-1`} /></label>
        <label className="text-sm font-medium text-ink">Margem desejada (%)<input value={extra.margin} onChange={(e) => setExtra({ ...extra, margin: e.target.value })} inputMode="decimal" className={`${field} mt-1`} /></label>
        <button type="submit" disabled={saveExtras.isPending} className={secondary}>Salvar custos</button>
      </form>
      <button type="button" disabled={snap.isPending} onClick={() => snap.mutate()} className={`${ghost} self-start`}>Salvar este cálculo no histórico</button>
    </div>
  )
}

/** Calculadora de custos (Premium): ficha técnica, taxas, margem e preço sugerido — tudo calculado no banco. */
export function CostingPanel() {
  const { business: b } = useGestao()
  const q = useQuery({ queryKey: ['gestao', 'costing', b.id], queryFn: () => listCosting(b.id) })
  const ing = useQuery({ queryKey: ['gestao', 'ingredients', b.id], queryFn: () => listIngredients(b.id) })
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-xl font-bold text-ink"><Calculator aria-hidden="true" className="size-5" />Calculadora de custos</h2>
      <Ingredients />
      <section className={box} aria-labelledby="produtos-custo">
        <h3 id="produtos-custo" className="mb-3 text-base font-semibold text-ink">Produtos</h3>
        {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (q.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">{q.isLoading ? 'Carregando…' : 'Cadastre produtos no cardápio para calcular.'}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(q.data ?? []).map((c) => (
              <li key={c.productId} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <p className="min-w-0 flex-1 font-semibold text-ink">{c.name}</p>
                  <button type="button" aria-expanded={open === c.productId} onClick={() => setOpen(open === c.productId ? null : c.productId)} className={secondary}>{open === c.productId ? 'Fechar' : 'Editar custos'}</button>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-6">
                  <div><dt className="text-xs text-ink-muted">Preço</dt><dd className="tabular-nums text-ink">{formatBRL(c.priceCents)}</dd></div>
                  <div><dt className="text-xs text-ink-muted">Custo unitário</dt><dd className="tabular-nums text-ink">{c.hasCost ? formatBRL(c.unitCostCents) : '—'}</dd></div>
                  <div><dt className="text-xs text-ink-muted">Taxas</dt><dd className="tabular-nums text-ink">{formatBRL(c.feeCents)}</dd></div>
                  <div><dt className="text-xs text-ink-muted">Lucro por unidade</dt><dd className={`tabular-nums ${c.marginCents < 0 ? 'text-danger' : 'text-ink'}`}>{c.hasCost ? money(c.marginCents) : '—'}</dd></div>
                  <div><dt className="text-xs text-ink-muted">Margem</dt><dd className="tabular-nums text-ink">{c.hasCost ? pct(c.marginBps) : '—'}</dd></div>
                  <div><dt className="text-xs text-ink-muted">Preço sugerido ({pct(c.targetMarginBps)})</dt><dd className="tabular-nums font-semibold text-ink">{c.suggestedCents !== null ? formatBRL(c.suggestedCents) : '—'}</dd></div>
                </dl>
                {open === c.productId && <ProductCosting c={c} ingredients={ing.data ?? []} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
