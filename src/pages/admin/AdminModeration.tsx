import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gavel } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { FilterChips } from '../../components/nav/FilterChips.tsx'
import {
  REPORT_REASONS,
  adminListAppeals,
  adminListReports,
  adminModerate,
  adminResolveAppeal,
  adminSuspend,
  type ModerationAppeal,
  type ModerationReport,
} from '../../features/conecta/repository.ts'
import { adminRemovePostMedia, mediaForPosts } from '../../features/media/repository.ts'
import { AdminHeader, dangerButton, errorMessage, formatDateTime, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

const REASON_LABEL: Record<string, string> = { ...REPORT_REASONS, auto_flag: 'Sinalização automática (termos de ameaça)' }
const TYPE_LABEL = { post: 'Publicação', comment: 'Comentário', profile: 'Perfil', suspension: 'Suspensão' } as Record<string, string>

/** Fotos/vídeo da publicação denunciada, com remoção individual (exige o motivo preenchido). */
function ReportMedia({ postId, note }: { postId: string; note: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['admin', 'moderation', 'media', postId], queryFn: async () => (await mediaForPosts([postId])).get(postId) ?? [] })
  const remove = useMutation({
    mutationFn: (id: string) => adminRemovePostMedia(id, note),
    onSuccess: () => { toast.success('Mídia removida (registrado na auditoria).'); void qc.invalidateQueries({ queryKey: ['admin', 'moderation', 'media', postId] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (!q.data || q.data.length === 0) return null
  return (
    <ul aria-label="Mídia da publicação" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {q.data.map((m, i) => (
        <li key={m.id} className="flex flex-col gap-1">
          {m.kind === 'image'
            ? <img src={m.url} alt={`Foto ${i + 1} denunciada`} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
            : <video src={m.url} controls preload="metadata" aria-label="Vídeo denunciado" className="aspect-square w-full rounded-lg bg-muted object-cover" />}
          <button type="button" disabled={remove.isPending || note.trim().length < 3} onClick={() => remove.mutate(m.id)} className={dangerButton}>Remover</button>
        </li>
      ))}
    </ul>
  )
}

function ReportRow({ r }: { r: ModerationReport }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [days, setDays] = useState(7)
  const done = () => {
    toast.success('Decisão registrada na auditoria.')
    void qc.invalidateQueries({ queryKey: ['admin', 'moderation'] })
  }
  const act = useMutation({ mutationFn: (a: 'dismiss' | 'hide') => adminModerate(r.id, a, note), onSuccess: done, onError: (e) => toast.error(errorMessage(e)) })
  const suspend = useMutation({ mutationFn: () => adminSuspend(r.authorId!, days, note), onSuccess: done, onError: (e) => toast.error(errorMessage(e)) })
  const open = r.status === 'open'
  return (
    <Panel className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-ink">{TYPE_LABEL[r.targetType]} · {REASON_LABEL[r.reason] ?? r.reason}</span>
        <span className="text-xs text-ink-muted">{formatDateTime(r.createdAt)} · {r.openReports} denúncia(s) abertas</span>
      </div>
      <p className="text-ink-muted">
        Autor: {r.authorHandle ? <Link to={`/conectuai/u/${r.authorHandle}`} className="font-semibold text-brand underline">@{r.authorHandle}</Link> : '—'}
        {' · '}Denunciante: {r.reporterEmail ?? 'sinalização automática'}
        {r.contentStatus === 'hidden' && ' · já oculto'}
      </p>
      <blockquote className="whitespace-pre-wrap break-words rounded-xl bg-muted p-3 text-ink">{r.contentBody || '(sem texto)'}</blockquote>
      {r.targetType === 'post' && <ReportMedia postId={r.targetId} note={note} />}
      {r.details && <p className="text-ink">Relato: {r.details}</p>}
      {open && (
        <>
          <label htmlFor={`mod-${r.id}`} className="font-medium text-ink">Motivo da decisão (vai para o autor e para a auditoria)</label>
          <textarea id={`mod-${r.id}`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputClass} min-h-20 py-2`} />
          <p className="text-xs text-ink-muted">Críticas e opiniões negativas legítimas devem ser mantidas.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={act.isPending || !note.trim()} onClick={() => act.mutate('dismiss')} className={secondaryButton}>Manter (sem violação)</button>
            {r.targetType !== 'profile' && <button type="button" disabled={act.isPending || !note.trim()} onClick={() => act.mutate('hide')} className={dangerButton}>Ocultar conteúdo</button>}
            {r.authorId && (
              <span className="inline-flex items-center gap-2">
                <label htmlFor={`days-${r.id}`} className="sr-only">Dias de suspensão</label>
                <select id={`days-${r.id}`} value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputClass} w-auto`}>
                  {[1, 7, 30, 90].map((d) => <option key={d} value={d}>{d} dia(s)</option>)}
                </select>
                <button type="button" disabled={suspend.isPending || !note.trim()} onClick={() => suspend.mutate()} className={dangerButton}>Suspender autor</button>
              </span>
            )}
          </div>
        </>
      )}
    </Panel>
  )
}

function AppealRow({ a }: { a: ModerationAppeal }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [note, setNote] = useState('')
  const m = useMutation({
    mutationFn: (d: 'uphold' | 'reverse') => adminResolveAppeal(a.id, d, note),
    onSuccess: () => {
      toast.success('Contestação respondida.')
      void qc.invalidateQueries({ queryKey: ['admin', 'moderation'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Panel className="flex flex-col gap-2 text-sm">
      <p className="font-semibold text-ink">{TYPE_LABEL[a.targetType]} · @{a.authorHandle} · {formatDateTime(a.createdAt)}</p>
      {a.contentBody && <blockquote className="whitespace-pre-wrap break-words rounded-xl bg-muted p-3 text-ink">{a.contentBody}</blockquote>}
      <p className="text-ink">Contestação: {a.reason}</p>
      <label htmlFor={`ap-${a.id}`} className="font-medium text-ink">Resposta</label>
      <textarea id={`ap-${a.id}`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputClass} min-h-20 py-2`} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={m.isPending || !note.trim()} onClick={() => m.mutate('reverse')} className={primaryButton}>Aceitar e desfazer</button>
        <button type="button" disabled={m.isPending || !note.trim()} onClick={() => m.mutate('uphold')} className={secondaryButton}>Manter decisão</button>
      </div>
    </Panel>
  )
}

/** Fila de moderação do Conectuaí: revisão humana, decisões motivadas e contestação. */
export function AdminModeration() {
  const [tab, setTab] = useState<'open' | 'appeals' | 'actioned' | 'dismissed'>('open')
  const reports = useQuery({ queryKey: ['admin', 'moderation', 'reports', tab], queryFn: () => adminListReports(tab === 'appeals' ? 'open' : tab), enabled: tab !== 'appeals' })
  const appeals = useQuery({ queryKey: ['admin', 'moderation', 'appeals'], queryFn: adminListAppeals, enabled: tab === 'appeals' })
  const q = tab === 'appeals' ? appeals : reports
  return (
    <>
      <AdminHeader title="Moderação do Conectuaí" subtitle="Denúncias revisadas por pessoas. Nenhum conteúdo é removido automaticamente." />
      <div className="mb-4">
        <FilterChips label="Fila" options={[{ value: 'open', label: 'Denúncias abertas' }, { value: 'appeals', label: 'Contestações' }, { value: 'actioned', label: 'Com ação' }, { value: 'dismissed', label: 'Mantidos' }]} value={tab} onChange={setTab} />
      </div>
      {q.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : tab === 'appeals' ? (
        (appeals.data ?? []).length === 0 ? <EmptyState icon={Gavel} title="Nenhuma contestação aberta" /> : <ul className="flex flex-col gap-3">{(appeals.data ?? []).map((a) => <li key={a.id}><AppealRow a={a} /></li>)}</ul>
      ) : (reports.data ?? []).length === 0 ? (
        <EmptyState icon={Gavel} title="Fila vazia" />
      ) : (
        <ul className="flex flex-col gap-3">{(reports.data ?? []).map((r) => <li key={r.id}><ReportRow r={r} /></li>)}</ul>
      )}
    </>
  )
}
