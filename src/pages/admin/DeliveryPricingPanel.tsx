import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { getDeliveryPricing, saveDeliveryPricing, type DeliveryPricing } from '../../features/admin/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { errorMessage, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

const km = (m: number) => (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
const toCents = (v: string) => Math.round(Number(v.replace(',', '.')) * 100)
const toMeters = (v: string) => Math.round(Number(v.replace(',', '.')) * 1000)

/** Tabela de frete da entrega parceira: faixas por distância e limites de cada parte. Mudanças viram nova versão. */
export function DeliveryPricingPanel({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['admin', 'delivery-pricing'], queryFn: getDeliveryPricing })
  const [draft, setDraft] = useState<{ bands: { km: string; pay: string }[]; tucai: string; cliente: string; loja: string; exige: boolean } | null>(null)
  useEffect(() => {
    if (q.data && !draft) {
      const d = q.data
      setDraft({ bands: d.faixas.map((f) => ({ km: km(f.ate_m), pay: (f.entregador_cents / 100).toFixed(2).replace('.', ',') })),
        tucai: (d.tucai_cents / 100).toFixed(2).replace('.', ','), cliente: (d.cliente_max_cents / 100).toFixed(2).replace('.', ','),
        loja: (d.loja_max_cents / 100).toFixed(2).replace('.', ','), exige: d.exige_cotacao })
    }
  }, [q.data, draft])
  const save = useMutation({
    mutationFn: () => saveDeliveryPricing({
      faixas: draft!.bands.map((b) => ({ ate_m: toMeters(b.km), entregador_cents: toCents(b.pay) })),
      tucai_cents: toCents(draft!.tucai), cliente_max_cents: toCents(draft!.cliente), loja_max_cents: toCents(draft!.loja), exige_cotacao: draft!.exige,
    }),
    onSuccess: (v) => { toast.success(`Tabela de frete salva (versão ${v}). Vale para os próximos pedidos.`); setDraft(null); void qc.invalidateQueries({ queryKey: ['admin', 'delivery-pricing'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const d: DeliveryPricing | null | undefined = q.data
  if (q.isLoading) return <p role="status" className="text-sm text-ink-muted">Carregando…</p>
  if (!d) return <p className="text-sm text-ink-muted">A tabela de frete por distância aparece aqui depois que o banco for atualizado (migration 0040).</p>
  return (
    <section aria-labelledby="frete" className="flex flex-col gap-4">
      <h2 id="frete" className="text-lg font-bold text-ink">Frete por distância (versão {d.versao})</h2>
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-xs text-ink-muted"><tr><th className="py-1">Distância por ruas</th><th>Entregador</th><th>Tucaí</th><th>Custo total</th><th>Cliente</th><th>Loja</th><th>Subsídio Tucaí</th></tr></thead>
          <tbody>
            {(d.tabela ?? []).map((t, i) => (
              <tr key={t.faixa} className="border-t border-line">
                <td className="py-2 text-ink">{i === 0 ? 'até' : `${km(d.faixas[i - 1]!.ate_m)} a`} {km(d.faixas[i]!.ate_m)} km</td>
                <td className="tabular-nums text-ink">{formatBRL(t.entregador_cents)}</td>
                <td className="tabular-nums text-ink">{formatBRL(d.tucai_cents)}</td>
                <td className="tabular-nums text-ink">{formatBRL(t.custo_cents)}</td>
                <td className="tabular-nums text-ink">{formatBRL(t.cliente_cents)}</td>
                <td className="tabular-nums text-ink">{formatBRL(t.loja_cents)}</td>
                <td className="tabular-nums text-ink">{t.subsidio_cents ? formatBRL(t.subsidio_cents) : '—'}</td>
              </tr>
            ))}
            <tr className="border-t border-line"><td className="py-2 text-ink">acima de {km(d.faixas.at(-1)!.ate_m)} km</td><td colSpan={6} className="text-ink-muted">sem entrega parceira</td></tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-muted">A loja paga até {formatBRL(d.loja_max_cents)} e o cliente o restante até {formatBRL(d.cliente_max_cents)}; o que faltar é subsídio da Tucaí. Frete grátis: a loja paga o custo total. {d.exige_cotacao ? 'Pedidos com entregador parceiro exigem o cálculo da distância.' : 'Sem cálculo de distância, vale a primeira faixa.'}</p>
      </Panel>
      {canEdit && draft && (
        <Panel className="flex flex-col gap-3 text-sm">
          <h3 className="font-bold text-ink">Editar tabela</h3>
          {draft.bands.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <label className="text-ink">Até (km)<input inputMode="decimal" value={b.km} onChange={(e) => setDraft({ ...draft, bands: draft.bands.map((x, j) => (j === i ? { ...x, km: e.target.value } : x)) })} className={inputClass} /></label>
              <label className="text-ink">Entregador recebe (R$)<input inputMode="decimal" value={b.pay} onChange={(e) => setDraft({ ...draft, bands: draft.bands.map((x, j) => (j === i ? { ...x, pay: e.target.value } : x)) })} className={inputClass} /></label>
              <button type="button" aria-label="Remover faixa" disabled={draft.bands.length === 1} onClick={() => setDraft({ ...draft, bands: draft.bands.filter((_, j) => j !== i) })} className={secondaryButton}><Trash2 aria-hidden="true" className="size-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setDraft({ ...draft, bands: [...draft.bands, { km: '', pay: '' }] })} className={`${secondaryButton} w-fit`}><Plus aria-hidden="true" className="size-4" />Adicionar faixa</button>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-ink">Tucaí por entrega (R$)<input inputMode="decimal" value={draft.tucai} onChange={(e) => setDraft({ ...draft, tucai: e.target.value })} className={inputClass} /></label>
            <label className="text-ink">Cliente paga no máximo (R$)<input inputMode="decimal" value={draft.cliente} onChange={(e) => setDraft({ ...draft, cliente: e.target.value })} className={inputClass} /></label>
            <label className="text-ink">Loja paga no máximo (R$)<input inputMode="decimal" value={draft.loja} onChange={(e) => setDraft({ ...draft, loja: e.target.value })} className={inputClass} /></label>
          </div>
          <label className="flex items-center gap-2 text-ink"><input type="checkbox" className="size-4" checked={draft.exige} onChange={(e) => setDraft({ ...draft, exige: e.target.checked })} />Exigir cálculo da distância nos pedidos com entregador parceiro (ligue depois de configurar o serviço de rotas)</label>
          <button type="button" disabled={save.isPending} onClick={() => { if (window.confirm('Salvar a nova tabela? Ela vale para os próximos pedidos; os pedidos já feitos não mudam.')) save.mutate() }} className={`${primaryButton} w-fit`}>Salvar nova versão</button>
        </Panel>
      )}
      {!canEdit && <p className="text-xs text-ink-muted">Só o Master com verificação em duas etapas altera a tabela.</p>}
    </section>
  )
}
