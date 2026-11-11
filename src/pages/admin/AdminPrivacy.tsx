import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { FilterChips } from '../../components/nav/FilterChips.tsx'
import {
  PRIVACY_KIND_LABEL,
  PRIVACY_STATUS_LABEL,
  adminListPrivacyRequests,
  adminResolvePrivacyRequest,
  privacyStatuses,
  type AdminPrivacyRequest,
  type PrivacyStatus,
} from '../../features/privacy/repository.ts'
import { AdminHeader, dangerButton, errorMessage, formatDateTime, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

function RequestRow({ r }: { r: AdminPrivacyRequest }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [anonymize, setAnonymize] = useState(false)
  const m = useMutation({
    mutationFn: (status: Exclude<PrivacyStatus, 'open'>) => adminResolvePrivacyRequest(r.id, status, note, anonymize),
    onSuccess: () => {
      toast.success('Atendimento registrado.')
      void qc.invalidateQueries({ queryKey: ['admin', 'privacy'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const closed = r.status === 'completed' || r.status === 'rejected'
  return (
    <Panel className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-ink">{PRIVACY_KIND_LABEL[r.kind]}</span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-ink">{PRIVACY_STATUS_LABEL[r.status]}</span>
      </div>
      <p className="text-ink-muted">{r.userEmail ?? 'conta excluída'} · recebida em {formatDateTime(r.createdAt)}</p>
      {r.details && <p className="whitespace-pre-wrap text-ink">{r.details}</p>}
      {r.resolutionNote && <p className="text-ink">Resultado: {r.resolutionNote}</p>}
      {!closed && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`pr-${r.id}`} className="font-medium text-ink">Resultado do atendimento (visível ao titular)</label>
          <textarea id={`pr-${r.id}`} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputClass} min-h-20 py-2`} />
          {r.kind === 'deletion' && (
            <label className="flex min-h-11 items-start gap-2 text-ink">
              <input type="checkbox" className="mt-0.5 size-5" checked={anonymize} onChange={(e) => setAnonymize(e.target.checked)} />
              <span>Anonimizar o perfil ao concluir (irreversível; registros fiscais e comerciais são mantidos). A conta de login é excluída no painel do Supabase, conforme docs/LGPD.md.</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {r.status === 'open' && <button type="button" disabled={m.isPending} onClick={() => m.mutate('in_progress')} className={secondaryButton}>Iniciar atendimento</button>}
            <button type="button" disabled={m.isPending || !note.trim()} onClick={() => m.mutate('completed')} className={primaryButton}>Concluir</button>
            <button type="button" disabled={m.isPending || !note.trim()} onClick={() => m.mutate('rejected')} className={dangerButton}>Não atender (com justificativa)</button>
          </div>
        </div>
      )}
    </Panel>
  )
}

/** Atendimento aos direitos do titular (permissão privacy.manage + MFA). */
export function AdminPrivacy() {
  const [status, setStatus] = useState<PrivacyStatus | 'all'>('open')
  const q = useQuery({ queryKey: ['admin', 'privacy', status], queryFn: () => adminListPrivacyRequests(status === 'all' ? null : status) })
  return (
    <>
      <AdminHeader title="Privacidade (LGPD)" subtitle="Solicitações dos titulares, com registro do resultado e auditoria." />
      <div className="mb-4">
        <FilterChips label="Situação" options={[...privacyStatuses.map((s) => ({ value: s, label: PRIVACY_STATUS_LABEL[s] })), { value: 'all' as const, label: 'Todas' }]} value={status} onChange={setStatus} />
      </div>
      {q.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nenhuma solicitação nesta situação" />
      ) : (
        <ul className="flex flex-col gap-3">{(q.data ?? []).map((r) => <li key={r.id}><RequestRow r={r} /></li>)}</ul>
      )}
    </>
  )
}
