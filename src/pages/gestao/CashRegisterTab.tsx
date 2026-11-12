import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Wallet } from 'lucide-react'
import { useState } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import {
  cashMovement, closeCash, getCashReport, getCashStatus, newOpId, openCash, type CashKind, type CashReport, type PayMethod,
} from '../../features/gestao/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { useGestao } from './context.ts'
import { box, field, hhmm, money, msg, parseCents, primary, secondary, SectionTitle, Stat } from './ui.tsx'

const KIND: Record<CashKind, string> = { venda: 'Venda', entrada: 'Entrada', saida: 'Saída', sangria: 'Sangria', suprimento: 'Suprimento' }
const METHOD: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', outro: 'Outro' }

function Report({ r }: { r: CashReport }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Saldo inicial" value={formatBRL(r.opening_cents)} />
        <Stat label="Vendas" value={formatBRL(r.by_kind.venda ?? 0)} />
        <Stat label="Entradas + suprimentos" value={formatBRL((r.by_kind.entrada ?? 0) + (r.by_kind.suprimento ?? 0))} />
        <Stat label="Saídas + sangrias" value={formatBRL((r.by_kind.saida ?? 0) + (r.by_kind.sangria ?? 0))} />
        <Stat label="Esperado em dinheiro" value={formatBRL(r.expected_cash_cents)} />
        {r.counted_cents !== null && <Stat label="Contado" value={formatBRL(r.counted_cents)} />}
        {r.difference_cents !== null && <Stat label="Diferença" value={money(r.difference_cents)} hint={r.difference_cents === 0 ? 'Caixa conferido' : r.difference_cents > 0 ? 'Sobra' : 'Falta'} />}
      </dl>
      {Object.keys(r.by_method).length > 0 && (
        <p className="text-sm text-ink">Vendas por forma: {Object.entries(r.by_method).map(([m, v]) => `${METHOD[m] ?? m} ${formatBRL(v)}`).join(' · ')}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <caption className="sr-only">Movimentações do caixa</caption>
          <thead className="text-xs text-ink-muted"><tr><th className="py-1 font-medium">Hora</th><th className="font-medium">Tipo</th><th className="font-medium">Forma</th><th className="font-medium">Descrição</th><th className="font-medium">Operador</th><th className="text-right font-medium">Valor</th></tr></thead>
          <tbody className="divide-y divide-line">
            {r.movements.length === 0 && <tr><td colSpan={6} className="py-2 text-ink-muted">Nenhuma movimentação ainda.</td></tr>}
            {r.movements.map((m, i) => (
              <tr key={i}>
                <td className="py-1.5 tabular-nums">{hhmm(m.at)}</td>
                <td>{KIND[m.kind as CashKind] ?? m.kind}</td>
                <td>{METHOD[m.method] ?? m.method}{m.confirmation === 'manual' ? ' (manual)' : ''}</td>
                <td className="text-ink-muted">{m.description ?? '—'}</td>
                <td className="text-ink-muted">{m.by?.split(' ')[0] ?? '—'}</td>
                <td className={`text-right tabular-nums ${m.kind === 'saida' || m.kind === 'sangria' ? 'text-danger' : ''}`}>{m.kind === 'saida' || m.kind === 'sangria' ? '− ' : ''}{formatBRL(m.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Caixa presencial (Premium): abertura, movimentações, sangria/suprimento e fechamento com conferência. */
export function CashRegisterTab() {
  const { business: b, can } = useGestao()
  const qc = useQueryClient()
  const toast = useToast()
  const status = useQuery({ queryKey: ['gestao', 'cash-status', b.id], queryFn: () => getCashStatus(b.id) })
  const sessionId = status.data?.open ? status.data.session_id : undefined
  const report = useQuery({ queryKey: ['gestao', 'cash-report', sessionId], queryFn: () => getCashReport(sessionId!), enabled: !!sessionId, refetchInterval: 30_000 })
  const [opening, setOpening] = useState('')
  const [mv, setMv] = useState<{ kind: CashKind; method: PayMethod; amount: string; description: string }>({ kind: 'entrada', method: 'dinheiro', amount: '', description: '' })
  const [op, setOp] = useState(newOpId)
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [closed, setClosed] = useState<CashReport | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['gestao'] })
  const open = useMutation({
    mutationFn: () => openCash(b.id, parseCents(opening) ?? 0),
    onSuccess: () => { toast.success('Caixa aberto.'); setOpening(''); setClosed(null); refresh() },
    onError: (e) => toast.error(msg(e)),
  })
  const move = useMutation({
    mutationFn: () => cashMovement(b.id, mv.kind, mv.method, parseCents(mv.amount) ?? 0, mv.description, op),
    onSuccess: () => { toast.success(`${KIND[mv.kind]} registrada.`); setMv({ ...mv, amount: '', description: '' }); setOp(newOpId()); refresh() },
    onError: (e) => toast.error(msg(e)),
  })
  const close = useMutation({
    mutationFn: () => closeCash(b.id, parseCents(counted) ?? -1, notes),
    onSuccess: (r) => { toast.success('Caixa fechado.'); setClosed(r); setCounted(''); setNotes(''); refresh() },
    onError: (e) => toast.error(msg(e)),
  })
  const restricted = mv.kind === 'saida' || mv.kind === 'sangria'
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title="Caixa" subtitle="Registro manual dos pagamentos presenciais. Sem integração com maquininha e sem emissão fiscal." />
      {status.isError ? <ErrorState error={status.error} onRetry={() => void status.refetch()} /> : !status.data ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : !status.data.open ? (
        <>
          <form onSubmit={(e) => { e.preventDefault(); open.mutate() }} className={`${box} flex flex-col gap-3 sm:flex-row sm:items-end`}>
            <div className="flex items-center gap-3 sm:mr-auto">
              <span className="grid size-11 place-items-center rounded-2xl bg-muted"><Wallet aria-hidden="true" className="size-5 text-ink" /></span>
              <div><p className="font-semibold text-ink">Caixa fechado</p><p className="text-sm text-ink-muted">Informe o troco inicial para começar.</p></div>
            </div>
            <label className="text-sm font-medium text-ink">Saldo inicial (R$)<input value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" placeholder="0,00" className={`${field} mt-1 sm:w-40`} /></label>
            <button type="submit" disabled={open.isPending || parseCents(opening) === null} className={primary}>Abrir caixa</button>
          </form>
          {closed && <section className={box}><h2 className="mb-3 text-base font-semibold text-ink">Relatório do fechamento</h2><Report r={closed} /></section>}
        </>
      ) : (
        <>
          <p className="text-sm text-ink">Aberto às <strong>{hhmm(status.data.opened_at!)}</strong>{status.data.opened_by ? <> por <strong>{status.data.opened_by}</strong></> : null}.</p>
          <form onSubmit={(e) => { e.preventDefault(); move.mutate() }} className={`${box} grid grid-cols-1 gap-3 sm:grid-cols-5 sm:items-end`}>
            <label className="text-sm font-medium text-ink">Tipo
              <select value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value as CashKind })} className={`${field} mt-1`}>
                <option value="entrada">Entrada</option><option value="suprimento">Suprimento</option>
                {can('reports.view') && <><option value="saida">Saída</option><option value="sangria">Sangria</option></>}
              </select>
            </label>
            <label className="text-sm font-medium text-ink">Forma
              <select value={mv.method} onChange={(e) => setMv({ ...mv, method: e.target.value as PayMethod })} className={`${field} mt-1`}>
                {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-ink">Valor (R$)<input value={mv.amount} onChange={(e) => setMv({ ...mv, amount: e.target.value })} inputMode="decimal" placeholder="0,00" className={`${field} mt-1`} /></label>
            <label className="text-sm font-medium text-ink">Descrição{restricted ? '' : ' (opcional)'}<input value={mv.description} onChange={(e) => setMv({ ...mv, description: e.target.value.slice(0, 120) })} required={restricted} className={`${field} mt-1`} /></label>
            <button type="submit" disabled={move.isPending || !parseCents(mv.amount)} className={secondary}>Registrar</button>
          </form>
          <section className={box} aria-labelledby="mov">
            <h2 id="mov" className="mb-3 text-base font-semibold text-ink">Movimentações</h2>
            {report.isError ? <ErrorState error={report.error} onRetry={() => void report.refetch()} /> : report.data ? <Report r={report.data} /> : <p className="text-sm text-ink-muted">Carregando…</p>}
          </section>
          <form onSubmit={(e) => { e.preventDefault(); if (window.confirm('Fechar o caixa agora?')) close.mutate() }} className={`${box} grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end`}>
            <h2 className="text-base font-semibold text-ink sm:col-span-3">Fechar caixa</h2>
            <label className="text-sm font-medium text-ink">Dinheiro contado (R$)<input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" placeholder="0,00" required className={`${field} mt-1`} /></label>
            <label className="text-sm font-medium text-ink">Observações<input value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 200))} className={`${field} mt-1`} /></label>
            <button type="submit" disabled={close.isPending || parseCents(counted) === null} className={primary}>Fechar caixa</button>
          </form>
        </>
      )}
    </div>
  )
}
