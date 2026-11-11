import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { FilterChips } from '../../components/nav/FilterChips.tsx'
import { Dialog } from '../../components/overlays/Dialog.tsx'
import {
  BUSINESS_PAGE_SIZE,
  businessStatuses,
  businessesPage,
  listCities,
  reviewBusiness,
  type BusinessCard,
  type BusinessStatus,
  type ReviewDecision,
} from '../../features/admin/repository.ts'
import { listCategories } from '../../features/catalog/repository.ts'
import { AdminHeader, dangerButton, errorMessage, formatDateTime, inputClass, Pager, primaryButton, secondaryButton } from './ui.tsx'

export const STATUS_LABEL: Record<BusinessStatus, string> = {
  pending: 'Aguardando análise',
  active: 'Ativo',
  suspended: 'Suspenso',
  rejected: 'Recusado',
}
const STATUS_DOT: Record<BusinessStatus, string> = { pending: 'bg-orange', active: 'bg-success', suspended: 'bg-danger', rejected: 'bg-ink-muted' }

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

function BusinessActions({ b, onDone }: { b: BusinessCard; onDone: () => void }) {
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
      onDone()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const actions = DECISIONS[b.status]
  const chosen = actions.find((a) => a.decision === pending)

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="inline text-ink-muted">Responsável: </dt><dd className="inline text-ink">{b.ownerName || '—'} ({b.ownerEmail ?? 'sem e-mail'})</dd></div>
        <div><dt className="inline text-ink-muted">Telefone: </dt><dd className="inline text-ink">{b.phone ?? '—'}</dd></div>
        <div><dt className="inline text-ink-muted">Endereço: </dt><dd className="inline text-ink">{b.address ?? '—'}</dd></div>
        <div><dt className="inline text-ink-muted">Enviado em: </dt><dd className="inline text-ink">{formatDateTime(b.submittedAt ?? b.createdAt)}</dd></div>
        <div><dt className="inline text-ink-muted">Categoria: </dt><dd className="inline text-ink">{b.category ?? '—'}</dd></div>
        <div><dt className="inline text-ink-muted">Endereço na Tucaí: </dt><dd className="inline text-ink">/{b.slug}</dd></div>
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
    </div>
  )
}

function Card({ b, onOpen }: { b: BusinessCard; onOpen: () => void }) {
  const img = b.logoUrl || b.coverUrl
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-card)]">
      <div className="grid aspect-[4/3] place-items-center bg-muted">
        {img ? <img src={img} alt="" loading="lazy" className="size-full object-cover" /> : <Building2 aria-hidden="true" className="size-10 text-ink-muted" />}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h2 className="line-clamp-2 text-base font-bold text-ink">{b.name}</h2>
        <p className="text-sm text-ink-muted">{b.city ? `${b.city} - ${b.state}` : 'Sem cidade'}</p>
        <p className="text-sm text-ink-muted">{TYPE_LABEL[b.type]}{b.category ? ` · ${b.category}` : ''}</p>
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
          <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_DOT[b.status]}`} />{STATUS_LABEL[b.status]}
          {b.isTest && <span className="ml-1 rounded-full bg-orange/15 px-2 py-0.5 text-accent">Teste</span>}
        </p>
        <button type="button" onClick={onOpen} className={`${secondaryButton} mt-auto w-full`}>Ver detalhes</button>
      </div>
    </article>
  )
}

/** Estabelecimentos em cards: busca, filtros (situação, cidade, categoria, tipo), detalhes e análise com auditoria no servidor. */
export function AdminBusinesses() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('status')
  const status: BusinessStatus | 'all' = raw && (businessStatuses as readonly string[]).includes(raw) ? (raw as BusinessStatus) : raw === 'all' ? 'all' : 'pending'
  const search = params.get('q') ?? ''
  const city = params.get('cidade') ?? ''
  const category = params.get('categoria') ?? ''
  const type = params.get('tipo') ?? ''
  const page = Math.max(1, Number(params.get('p') ?? '1') || 1)
  const [term, setTerm] = useState(search)
  const [open, setOpen] = useState<BusinessCard | null>(null)
  const cities = useQuery({ queryKey: ['admin', 'cities'], queryFn: listCities, staleTime: 300_000 })
  const categories = useQuery({ queryKey: ['catalog', 'categories', 'all'], queryFn: () => listCategories(), staleTime: 300_000 })
  const q = useQuery({
    queryKey: ['admin', 'businesses', status, search, city, category, type, page],
    queryFn: () => businessesPage({ status: status === 'all' ? '' : status, search, city, category, type }, page),
    placeholderData: keepPreviousData,
  })
  const update = (next: Record<string, string>, keepPage = false) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    if (!keepPage) p.delete('p')
    setParams(p, { replace: true })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    update({ q: term.trim() })
  }
  const rows = q.data ?? []

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
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <form role="search" onSubmit={submit} className="flex gap-2 lg:col-span-1">
            <label htmlFor="adm-busca" className="sr-only">Buscar por nome ou e-mail do responsável</label>
            <input id="adm-busca" type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar estabelecimento" className={inputClass} />
            <button type="submit" className={secondaryButton} aria-label="Buscar"><Search aria-hidden="true" className="size-4" /></button>
          </form>
          <label className="sr-only" htmlFor="adm-cidade">Cidade</label>
          <select id="adm-cidade" value={city} onChange={(e) => update({ cidade: e.target.value })} className={inputClass}>
            <option value="">Todas as cidades</option>
            {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} - {c.state}</option>)}
          </select>
          <label className="sr-only" htmlFor="adm-categoria">Categoria</label>
          <select id="adm-categoria" value={category} onChange={(e) => update({ categoria: e.target.value })} className={inputClass}>
            <option value="">Todas as categorias</option>
            {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.label} ({TYPE_LABEL[c.kind as keyof typeof TYPE_LABEL] ?? c.kind})</option>)}
          </select>
          <label className="sr-only" htmlFor="adm-tipo">Tipo de negócio</label>
          <select id="adm-tipo" value={type} onChange={(e) => update({ tipo: e.target.value })} className={inputClass}>
            <option value="">Todos os tipos</option>
            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      {q.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Building2} title="Nada por aqui" description={status === 'pending' ? 'Nenhuma solicitação aguardando análise.' : 'Nenhum estabelecimento com estes filtros.'} />
      ) : (
        <>
          <ul className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${q.isFetching ? 'opacity-60' : ''}`}>
            {rows.map((b) => (
              <li key={b.id}><Card b={b} onOpen={() => setOpen(b)} /></li>
            ))}
          </ul>
          <div className="mt-4"><Pager page={page} pageSize={BUSINESS_PAGE_SIZE} total={rows[0]?.total ?? 0} onPage={(p) => update({ p: String(p) }, true)} loading={q.isFetching} /></div>
        </>
      )}
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''}>
        {open && <BusinessActions b={open} onDone={() => setOpen(null)} />}
      </Dialog>
    </>
  )
}
