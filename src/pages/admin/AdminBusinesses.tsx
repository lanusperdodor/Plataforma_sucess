import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { FilterChips } from '../../components/nav/FilterChips.tsx'
import {
  businessStatuses,
  listBusinesses,
  reviewBusiness,
  type AdminBusiness,
  type BusinessStatus,
  type ReviewDecision,
} from '../../features/admin/repository.ts'
import { AdminHeader, dangerButton, errorMessage, formatDateTime, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

export const STATUS_LABEL: Record<BusinessStatus, string> = {
  pending: 'Aguardando análise',
  active: 'Ativo',
  suspended: 'Suspenso',
  rejected: 'Recusado',
}

const TYPE_LABEL = { restaurante: 'Restaurante', loja: 'Loja', servico: 'Serviço' } as const

const DECISIONS: Record<BusinessStatus, { decision: ReviewDecision; label: string; needsNote: boolean; danger?: boolean }[]> = {
  pending: [
    { decision: 'approve', label: 'Aprovar', needsNote: false },
    { decision: 'reject', label: 'Recusar', needsNote: true, danger: true },
  ],
  rejected: [{ decision: 'approve', label: 'Aprovar mesmo assim', needsNote: false }],
  active: [{ decision: 'suspend', label: 'Suspender', needsNote: true, danger: true }],
  suspended: [{ decision: 'reactivate', label: 'Reativar', needsNote: false }],
}

function BusinessRow({ b }: { b: AdminBusiness }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [pending, setPending] = useState<ReviewDecision | null>(null)
  const m = useMutation({
    mutationFn: ({ decision }: { decision: ReviewDecision }) => reviewBusiness(b.id, decision, note),
    onSuccess: (status) => {
      toast.success(`${b.name}: ${STATUS_LABEL[status].toLowerCase()}.`)
      setNote('')
      setPending(null)
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const actions = DECISIONS[b.status]
  const chosen = actions.find((a) => a.decision === pending)

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink">{b.name}</h2>
          <p className="text-sm text-ink-muted">
            {TYPE_LABEL[b.businessType]}
            {b.categoryLabel ? ` · ${b.categoryLabel}` : ''}
            {b.city ? ` · ${b.city}` : ''}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-ink">{STATUS_LABEL[b.status]}</span>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="inline text-ink-muted">Responsável: </dt><dd className="inline text-ink">{b.ownerName || '—'} ({b.ownerEmail ?? 'sem e-mail'})</dd></div>
        <div><dt className="inline text-ink-muted">Telefone: </dt><dd className="inline text-ink">{b.phone ?? '—'}</dd></div>
        <div><dt className="inline text-ink-muted">Endereço: </dt><dd className="inline text-ink">{b.addressLine ?? '—'}</dd></div>
        <div><dt className="inline text-ink-muted">Enviado em: </dt><dd className="inline text-ink">{formatDateTime(b.submittedAt ?? b.createdAt)}</dd></div>
        {b.reviewedAt && <div><dt className="inline text-ink-muted">Última análise: </dt><dd className="inline text-ink">{formatDateTime(b.reviewedAt)}</dd></div>}
        {b.reviewNote && <div className="sm:col-span-2"><dt className="inline text-ink-muted">Motivo registrado: </dt><dd className="inline text-ink">{b.reviewNote}</dd></div>}
      </dl>
      {b.description && <p className="text-sm text-ink">{b.description}</p>}

      {chosen?.needsNote ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            m.mutate({ decision: chosen.decision })
          }}
        >
          <label htmlFor={`note-${b.id}`} className="text-sm font-medium text-ink">Motivo (enviado ao responsável)</label>
          <textarea
            id={`note-${b.id}`}
            required
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${inputClass} min-h-20 py-2`}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={m.isPending || !note.trim()} className={dangerButton}>Confirmar: {chosen.label.toLowerCase()}</button>
            <button type="button" onClick={() => setPending(null)} className={secondaryButton}>Cancelar</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a.decision}
              type="button"
              disabled={m.isPending}
              onClick={() => (a.needsNote ? setPending(a.decision) : m.mutate({ decision: a.decision }))}
              className={a.danger ? dangerButton : primaryButton}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </Panel>
  )
}

/** Solicitações e estabelecimentos: análise com motivo registrado e auditoria no servidor. */
export function AdminBusinesses() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('status')
  const status: BusinessStatus | 'all' = raw && (businessStatuses as readonly string[]).includes(raw) ? (raw as BusinessStatus) : raw === 'all' ? 'all' : 'pending'
  const [term, setTerm] = useState(params.get('q') ?? '')
  const search = params.get('q') ?? ''
  const q = useQuery({
    queryKey: ['admin', 'businesses', status, search],
    queryFn: () => listBusinesses(status === 'all' ? null : status, search),
  })
  const update = (next: Record<string, string>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    setParams(p, { replace: true })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    update({ q: term.trim() })
  }

  return (
    <>
      <AdminHeader title="Estabelecimentos" subtitle="Solicitações de cadastro, aprovações e suspensões." />
      <div className="mb-4 flex flex-col gap-3">
        <FilterChips
          label="Situação"
          options={[...businessStatuses.map((s) => ({ value: s, label: STATUS_LABEL[s] })), { value: 'all', label: 'Todos' }]}
          value={status}
          onChange={(v) => update({ status: v })}
        />
        <form role="search" onSubmit={submit} className="flex max-w-md gap-2">
          <label htmlFor="adm-busca" className="sr-only">Buscar por nome</label>
          <input id="adm-busca" type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar por nome" className={inputClass} />
          <button type="submit" className={secondaryButton} aria-label="Buscar"><Search aria-hidden="true" className="size-4" /></button>
        </form>
      </div>
      {q.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={Building2} title="Nada por aqui" description={status === 'pending' ? 'Nenhuma solicitação aguardando análise.' : 'Nenhum estabelecimento nesta situação.'} />
      ) : (
        <ul className="flex flex-col gap-3">
          {(q.data ?? []).map((b) => (
            <li key={b.id}><BusinessRow b={b} /></li>
          ))}
        </ul>
      )}
    </>
  )
}
