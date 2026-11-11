import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bike, Search } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { FilterChips } from '../../components/nav/FilterChips.tsx'
import { courierHistory, couriersPage, type CourierFilter, type CourierRow } from '../../features/admin/repository.ts'
import { VEHICLE_LABEL, adminReviewCourier, type CourierStatus } from '../../features/courier/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { AdminHeader, dangerButton, errorMessage, formatDateTime, inputClass, Pager, Panel, primaryButton, secondaryButton } from './ui.tsx'

const LABEL: Record<CourierStatus, string> = { pending: 'Em análise', approved: 'Aprovado', rejected: 'Recusado', suspended: 'Suspenso' }
const FILTERS: { value: CourierFilter; label: string }[] = [
  { value: 'todos', label: 'Todos' }, { value: 'pending', label: 'Em análise' }, { value: 'approved', label: 'Aprovados' },
  { value: 'rejected', label: 'Recusados' }, { value: 'suspended', label: 'Suspensos' },
]

function History({ userId }: { userId: string }) {
  const q = useQuery({ queryKey: ['admin', 'courier-history', userId], queryFn: () => courierHistory(userId) })
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <p role="status" className="text-ink-muted">Carregando…</p>
  if (q.data.length === 0) return <p className="text-ink-muted">Nenhuma entrega registrada.</p>
  return (
    <ul className="divide-y divide-line">
      {q.data.map((h) => (
        <li key={h.orderId} className="flex flex-wrap justify-between gap-2 py-1.5">
          <span>#{h.code} · {h.business}{h.isTest ? ' · teste' : ''}</span>
          <span className="text-ink-muted">{h.status} · {formatBRL(h.payCents)}{h.deliveredAt ? ` · ${formatDateTime(h.deliveredAt)}` : ''}</span>
        </li>
      ))}
    </ul>
  )
}
type Decision = 'approve' | 'reject' | 'suspend' | 'reactivate'
const ACTIONS: Record<CourierStatus, { d: Decision; label: string; note: boolean }[]> = {
  pending: [{ d: 'approve', label: 'Aprovar', note: false }, { d: 'reject', label: 'Recusar', note: true }],
  rejected: [{ d: 'approve', label: 'Aprovar mesmo assim', note: false }],
  approved: [{ d: 'suspend', label: 'Suspender', note: true }],
  suspended: [{ d: 'reactivate', label: 'Reativar', note: false }],
}

function Row({ c }: { c: CourierRow }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const m = useMutation({
    mutationFn: (d: Decision) => adminReviewCourier(c.userId, d, note),
    onSuccess: () => {
      toast.success('Decisão registrada na auditoria.')
      void qc.invalidateQueries({ queryKey: ['admin', 'couriers'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const actions = ACTIONS[c.status]
  return (
    <Panel className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-base font-bold text-ink">
          {c.fullName}
          {c.isTest && <span className="rounded-full bg-orange/15 px-2 py-0.5 text-xs font-semibold text-accent">Teste</span>}
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-ink">{LABEL[c.status]}</span>
        </span>
        {c.status === 'approved' && <span className={`text-xs font-semibold ${c.isOnline ? 'text-success' : 'text-ink-muted'}`}>{c.isOnline ? 'Online agora' : 'Offline'}</span>}
      </div>
      <p className="text-ink-muted">{c.email} · {c.phone} · {c.city ?? '—'}</p>
      <p className="text-ink">{VEHICLE_LABEL[c.vehicle]}{c.plate ? ` · placa ${c.plate}` : ''}{c.cnh ? ` · CNH ${c.cnh}` : ''} · enviado em {formatDateTime(c.submittedAt)}</p>
      <p className="text-ink">Entregas concluídas: <strong>{c.deliveriesDone}</strong>{c.deliveriesActive ? ` · ${c.deliveriesActive} em andamento` : ''}{c.lastDeliveryAt ? ` · última em ${formatDateTime(c.lastDeliveryAt)}` : ''}</p>
      {c.reviewNote && <p className="text-ink">Motivo registrado: {c.reviewNote}</p>}
      {actions.some((a) => a.note) && (
        <>
          <label htmlFor={`cn-${c.userId}`} className="font-medium text-ink">Motivo (obrigatório para recusar ou suspender)</label>
          <textarea id={`cn-${c.userId}`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputClass} min-h-16 py-2`} />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button key={a.d} type="button" disabled={m.isPending || (a.note && !note.trim())} onClick={() => m.mutate(a.d)} className={a.note ? dangerButton : primaryButton}>{a.label}</button>
        ))}
        <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)} className={secondaryButton}>{showHistory ? 'Ocultar histórico' : 'Ver histórico'}</button>
      </div>
      {showHistory && <History userId={c.userId} />}
    </Panel>
  )
}

/** Entregadores parceiros: todos os cadastros (antes a tela abria só com os pendentes), busca, entregas reais e histórico. */
export function AdminCouriers() {
  const [status, setStatus] = useState<CourierFilter>('todos')
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [page, setPage] = useState(1)
  const q = useQuery({ queryKey: ['admin', 'couriers', status, term, page], queryFn: () => couriersPage(status, term, page), placeholderData: keepPreviousData })
  const rows = q.data ?? []
  return (
    <>
      <AdminHeader title="Entregadores" subtitle="Profissionais independentes: cadastro, aprovação, disponibilidade e entregas." />
      <div className="mb-4 flex flex-col gap-3">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setTerm(search) }}>
          <label className="min-w-56 flex-1 text-sm font-medium text-ink">Buscar por nome ou e-mail
            <span className="relative block">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} pl-9`} />
            </span>
          </label>
          <button type="submit" className={primaryButton}>Buscar</button>
        </form>
        <FilterChips label="Situação" options={FILTERS} value={status} onChange={(v) => { setPage(1); setStatus(v) }} />
      </div>
      {q.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Bike} title="Nenhum entregador nesta situação" />
      ) : (
        <>
          <ul className="flex flex-col gap-3">{rows.map((c) => <li key={c.userId}><Row c={c} /></li>)}</ul>
          <div className="mt-3"><Pager page={page} pageSize={30} total={rows[0]?.total ?? 0} onPage={setPage} loading={q.isFetching} /></div>
        </>
      )}
    </>
  )
}
