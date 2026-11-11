import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bike } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { FilterChips } from '../../components/nav/FilterChips.tsx'
import { VEHICLE_LABEL, adminListCouriers, adminReviewCourier, courierStatuses, type AdminCourier, type CourierStatus } from '../../features/courier/repository.ts'
import { AdminHeader, dangerButton, errorMessage, formatDateTime, inputClass, Panel, primaryButton } from './ui.tsx'

const LABEL: Record<CourierStatus, string> = { pending: 'Em análise', approved: 'Aprovados', rejected: 'Recusados', suspended: 'Suspensos' }
type Decision = 'approve' | 'reject' | 'suspend' | 'reactivate'
const ACTIONS: Record<CourierStatus, { d: Decision; label: string; note: boolean }[]> = {
  pending: [{ d: 'approve', label: 'Aprovar', note: false }, { d: 'reject', label: 'Recusar', note: true }],
  rejected: [{ d: 'approve', label: 'Aprovar mesmo assim', note: false }],
  approved: [{ d: 'suspend', label: 'Suspender', note: true }],
  suspended: [{ d: 'reactivate', label: 'Reativar', note: false }],
}

function Row({ c }: { c: AdminCourier }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [note, setNote] = useState('')
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
        <span className="text-base font-bold text-ink">{c.fullName}</span>
        {c.status === 'approved' && <span className={`text-xs font-semibold ${c.isOnline ? 'text-success' : 'text-ink-muted'}`}>{c.isOnline ? 'Disponível agora' : 'Indisponível'}</span>}
      </div>
      <p className="text-ink-muted">{c.email} · {c.phone} · {c.city ?? '—'}</p>
      <p className="text-ink">{VEHICLE_LABEL[c.vehicle]}{c.plate ? ` · placa ${c.plate}` : ''}{c.cnh ? ` · CNH ${c.cnh}` : ''} · enviado em {formatDateTime(c.submittedAt)}</p>
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
      </div>
    </Panel>
  )
}

/** Análise de entregadores parceiros (permissão couriers.review + MFA). */
export function AdminCouriers() {
  const [status, setStatus] = useState<CourierStatus>('pending')
  const q = useQuery({ queryKey: ['admin', 'couriers', status], queryFn: () => adminListCouriers(status) })
  return (
    <>
      <AdminHeader title="Entregadores" subtitle="Cadastros de entregadores parceiros, aprovação e suspensão." />
      <div className="mb-4"><FilterChips label="Situação" options={courierStatuses.map((s) => ({ value: s, label: LABEL[s] }))} value={status} onChange={setStatus} /></div>
      {q.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={Bike} title="Nenhum cadastro nesta situação" />
      ) : (
        <ul className="flex flex-col gap-3">{(q.data ?? []).map((c) => <li key={c.userId}><Row c={c} /></li>)}</ul>
      )}
    </>
  )
}
