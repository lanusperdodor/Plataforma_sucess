import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bike, Briefcase, Phone, Plus, ReceiptText } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import {
  APPLICATION_LABEL,
  AREA_LABEL,
  EMPLOYMENT_LABEL,
  JOB_STATUS_LABEL,
  WORK_MODE_LABEL,
  employments,
  jobAreas,
  jobFormSchema,
  listBusinessJobs,
  listJobApplications,
  saveJob,
  setJobStatus,
  updateApplicationStatus,
  workModes,
  type ApplicationStatus,
  type Job,
  type JobForm,
} from '../../features/jobs/repository.ts'
import {
  FULFILLMENT_LABEL,
  PAYMENT_LABEL,
  STATUS_LABEL,
  STEP_ACTION,
  acceptOrder,
  dispatchTick,
  getSalesSummary,
  listBusinessDeliveries,
  listBusinessOrders,
  listBusinessReviews,
  listOrderItems,
  replyReview,
  staffNextSteps,
  updateOrderStatus,
  type Order,
  type OrderStatus,
} from '../../features/orders/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { useSearchParams } from 'react-router-dom'
import { getMyPlan } from '../../features/merchant/repository.ts'
import { createPaymentLink } from '../../features/payments/repository.ts'
import { phoneDigits } from '../BusinessPage.tsx'
import { dateTime } from '../OrdersPage.tsx'

const field = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink'
const primary = 'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-surface disabled:opacity-50'
const secondary = 'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink disabled:opacity-50'
const box = 'rounded-card border border-line bg-surface p-4 md:p-6'
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Algo deu errado. Tente novamente.')

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink">{children}</label>
}

const DELIVERY_TEXT = { offered: 'Aguardando entregador parceiro', accepted: 'Entregador a caminho da loja', picked_up: 'Com o entregador', delivered: 'Entregue', cancelled: 'Entrega cancelada' } as const

// ---------- Pedidos ----------
const PREP_OPTIONS = [10, 15, 20, 30, 45, 60]
const KITCHEN_STEPS: OrderStatus[] = ['preparing', 'ready']

export function OrdersTab({ businessId, canUpdate, kitchen = false }: { businessId: string; canUpdate: boolean; kitchen?: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [scope, setScope] = useState<'open' | 'done'>('open')
  const [prep, setPrep] = useState<Record<string, number>>({})
  // expira e redistribui ofertas vencidas ao acompanhar os pedidos (o banco decide; falha aqui não bloqueia nada)
  useQuery({ queryKey: ['merchant', 'dispatch-tick', businessId], queryFn: () => dispatchTick().catch(() => 0), refetchInterval: 60_000, enabled: scope === 'open' })
  const orders = useQuery({ queryKey: ['merchant', 'orders', businessId, scope], queryFn: () => listBusinessOrders(businessId, scope), refetchInterval: scope === 'open' ? 15_000 : false })
  const ids = (orders.data ?? []).map((o) => o.id)
  const items = useQuery({ queryKey: ['merchant', 'order-items', ids.join(',')], queryFn: () => listOrderItems(ids), enabled: ids.length > 0 })
  const deliveries = useQuery({ queryKey: ['merchant', 'deliveries', ids.join(',')], queryFn: () => listBusinessDeliveries(ids), enabled: ids.length > 0, refetchInterval: scope === 'open' ? 15_000 : false })
  const change = useMutation({
    mutationFn: (a: { order: Order; status: OrderStatus }) => {
      let note = ''
      if (a.status === 'rejected' || a.status === 'cancelled') {
        note = window.prompt(a.status === 'rejected' ? 'Motivo da recusa (o cliente verá):' : 'Motivo do cancelamento (o cliente verá):')?.trim() ?? ''
        if (!note) return Promise.reject(new Error('Informe o motivo.'))
      }
      if (a.status === 'accepted') return acceptOrder(a.order.id, prep[a.order.id] ?? 20)
      return updateOrderStatus(a.order.id, a.status, note)
    },
    onSuccess: (s) => {
      toast.success(`Pedido: ${STATUS_LABEL[s].toLowerCase()}.`)
      void qc.invalidateQueries({ queryKey: ['merchant', 'orders', businessId] })
      void qc.invalidateQueries({ queryKey: ['merchant', 'deliveries'] })
    },
    onError: (e) => toast.error(msg(e)),
  })

  return (
    <div className="flex flex-col gap-3">
      {kitchen && <p className="rounded-xl bg-muted p-3 text-sm text-ink">Visão da cozinha: você inicia e conclui o preparo dos pedidos aceitos pelo atendimento.</p>}
      <div className="flex gap-2">
        {(['open', 'done'] as const).map((s) => (
          <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)} className={scope === s ? primary : secondary}>{s === 'open' ? 'Em andamento' : 'Concluídos'}</button>
        ))}
      </div>
      {orders.isError ? (
        <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
      ) : (orders.data ?? []).length === 0 ? (
        <EmptyState icon={ReceiptText} title={orders.isLoading ? 'Carregando…' : scope === 'open' ? 'Nenhum pedido em andamento' : 'Nenhum pedido concluído'} description={scope === 'open' ? 'Novos pedidos aparecem aqui sozinhos e você recebe uma notificação.' : undefined} />
      ) : (
        <ul className="flex flex-col gap-3">
          {(orders.data ?? []).map((o) => {
            const lines = (items.data ?? []).filter((i) => i.orderId === o.id)
            const d = (deliveries.data ?? []).find((x) => x.orderId === o.id)
            const tel = phoneDigits(o.customerPhone)
            return (
              <li key={o.id} className={`${box} flex flex-col gap-2 ${o.status === 'placed' ? 'border-orange' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-ink">#{o.code} · {o.customerName}</h3>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${o.status === 'placed' ? 'bg-orange text-ink' : 'bg-muted text-ink'}`}>{STATUS_LABEL[o.status]}</span>
                </div>
                <p className="text-xs text-ink-muted">{dateTime.format(new Date(o.createdAt))} · {FULFILLMENT_LABEL[o.fulfillment]} · {PAYMENT_LABEL[o.payment]}{o.changeForCents ? ` (troco para ${formatBRL(o.changeForCents)})` : ''}</p>
                <ul className="text-sm text-ink">
                  {lines.map((i) => (
                    <li key={i.id}>{i.quantity}× {i.name}{i.options.length > 0 && <span className="text-ink-muted"> ({i.options.join(', ')})</span>}{i.notes && <span className="text-ink-muted"> · obs.: {i.notes}</span>}</li>
                  ))}
                </ul>
                {o.notes && <p className="text-sm text-ink">Observações: {o.notes}</p>}
                {o.address && <p className="text-sm text-ink">Entregar em: {o.address}{o.reference ? ` (${o.reference})` : ''}</p>}
                {o.estimatedReadyAt && (o.status === 'accepted' || o.status === 'preparing') && (
                  <p className="text-sm text-ink">Previsão de pronto: <strong>{new Date(o.estimatedReadyAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong> ({o.prepMinutes} min)</p>
                )}
                {d && (
                  <p className="flex flex-wrap items-center gap-1 text-sm text-ink">
                    <Bike aria-hidden="true" className="size-4" />{DELIVERY_TEXT[d.status]}
                    {d.status === 'offered' && d.offerRound > 1 && <span className="text-ink-muted">· {d.offerRound}ª rodada de oferta</span>}
                  </p>
                )}
                {d?.attention && <p role="status" className="rounded-xl bg-orange/15 p-2 text-sm font-semibold text-ink">Atenção: {d.attention}. A equipe Tucaí foi avisada.</p>}
                {o.rejectionReason && <p className="text-sm text-ink-muted">Motivo: {o.rejectionReason}</p>}
                <p className="text-sm">
                  Total <strong>{formatBRL(o.totalCents)}</strong>
                  <span className="text-ink-muted"> · comissão {formatBRL(o.commissionCents)}{o.merchantDeliveryCents ? ` · logística ${formatBRL(o.merchantDeliveryCents)}` : ''}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {canUpdate && staffNextSteps(o.status, o.fulfillment).filter((s) => !kitchen || KITCHEN_STEPS.includes(s)).map((s) => (
                    <span key={s} className="inline-flex items-center gap-2">
                      {s === 'accepted' && (
                        <label className="inline-flex items-center gap-1 text-sm text-ink">
                          Preparo
                          <select value={prep[o.id] ?? 20} onChange={(e) => setPrep((p) => ({ ...p, [o.id]: Number(e.target.value) }))} className="min-h-11 rounded-xl border border-line bg-surface px-2 text-sm">
                            {PREP_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
                          </select>
                        </label>
                      )}
                      <button type="button" disabled={change.isPending} onClick={() => change.mutate({ order: o, status: s })} className={s === 'rejected' || s === 'cancelled' ? secondary : primary}>
                        {STEP_ACTION[s]}
                      </button>
                    </span>
                  ))}
                  {tel && <a href={`tel:${tel}`} className={secondary}><Phone aria-hidden="true" className="size-4" />Ligar</a>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------- Vendas ----------
export function SalesTab({ businessId }: { businessId: string }) {
  const [days, setDays] = useState(30)
  const q = useQuery({ queryKey: ['merchant', 'sales', businessId, days], queryFn: () => getSalesSummary(businessId, days) })
  const s = q.data
  return (
    <div className={`${box} flex flex-col gap-4`}>
      <div className="flex flex-wrap gap-2">
        {[7, 30, 90].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={days === d ? primary : secondary}>{d} dias</button>)}
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !s ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {([
              ['Pedidos concluídos', String(s.ordersCompleted)],
              ['Vendas (itens)', formatBRL(s.grossCents)],
              ['Comissão Tucaí', formatBRL(s.commissionCents)],
              ['Logística', formatBRL(s.deliveryCostsCents)],
              ['Seu líquido', formatBRL(Math.max(0, s.netCents))],
              ['Pedidos recebidos', String(s.ordersTotal)],
              ['Recusados/cancelados', String(s.ordersCancelled)],
              ['Ticket médio', s.ordersCompleted ? formatBRL(Math.round(s.grossCents / s.ordersCompleted)) : '—'],
            ] as const).map(([l, v]) => (
              <div key={l} className="rounded-xl bg-muted p-3"><dt className="text-xs text-ink-muted">{l}</dt><dd className="text-lg font-bold text-ink">{v}</dd></div>
            ))}
          </dl>
          <div>
            <h3 className="mb-2 text-base font-semibold text-ink">Mais vendidos</h3>
            {s.topProducts.length === 0 ? <p className="text-sm text-ink-muted">Sem vendas concluídas no período.</p> : (
              <ol className="divide-y divide-line text-sm">
                {s.topProducts.map((t) => <li key={t.name} className="flex justify-between py-2"><span>{t.name}</span><span>{t.qty} un. · {formatBRL(t.totalCents)}</span></li>)}
              </ol>
            )}
          </div>
          <p className="text-xs text-ink-muted">Comissão de 2% só acima de R$ 50 por pedido. Logística: R$ 2,00 por entrega parceira + R$ 1,00 de tarifa por entrega gerenciada. Valores dos pedidos concluídos, gravados no momento do pedido.</p>
        </>
      )}
    </div>
  )
}

// ---------- Avaliações ----------
export function ReviewsTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['merchant', 'reviews', businessId], queryFn: () => listBusinessReviews(businessId) })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const reply = useMutation({
    mutationFn: (a: { id: string; text: string }) => replyReview(a.id, a.text),
    onSuccess: () => { toast.success('Resposta publicada.'); void qc.invalidateQueries({ queryKey: ['merchant', 'reviews', businessId] }); void qc.invalidateQueries({ queryKey: ['store'] }) },
    onError: (e) => toast.error(msg(e)),
  })
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if ((q.data ?? []).length === 0) return <EmptyState title={q.isLoading ? 'Carregando…' : 'Nenhuma avaliação ainda'} description="Clientes avaliam depois de receber o pedido. Avaliações aparecem quando a loja está publicada." />
  return (
    <ul className="flex flex-col gap-3">
      {(q.data ?? []).map((r) => (
        <li key={r.id} className={`${box} flex flex-col gap-2`}>
          <p className="font-semibold text-ink">{'★'.repeat(r.rating)}<span className="sr-only">{r.rating} de 5</span> · {r.authorName ?? 'Cliente'} <span className="text-xs font-normal text-ink-muted">{dateTime.format(new Date(r.createdAt))}</span></p>
          {r.comment && <p className="text-sm text-ink">{r.comment}</p>}
          {r.reply ? (
            <p className="border-l-2 border-brand pl-2 text-sm text-ink"><span className="font-semibold">Sua resposta:</span> {r.reply}</p>
          ) : (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const text = (drafts[r.id] ?? '').trim()
                if (text) reply.mutate({ id: r.id, text })
              }}
            >
              <label htmlFor={`rp-${r.id}`} className="text-sm font-medium text-ink">Responder publicamente</label>
              <textarea id={`rp-${r.id}`} maxLength={1000} value={drafts[r.id] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))} className={`${field} min-h-16 py-2`} />
              <button type="submit" disabled={reply.isPending || !(drafts[r.id] ?? '').trim()} className={`${primary} w-fit`}>Publicar resposta</button>
            </form>
          )}
        </li>
      ))}
    </ul>
  )
}

// ---------- Vagas ----------
const emptyJob: JobForm = { title: '', area: 'atendimento', description: '', requirements: '', benefits: '', employment: 'clt', workMode: 'presencial', salaryMin: '', salaryMax: '', openings: '1', days: '30' }
const centsToText = (c: number | null) => (c ? formatBRL(c).replace('R$ ', '') : '')

function JobEditor({ businessId, job, onDone }: { businessId: string; job: Job | null; onDone: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [v, setV] = useState<JobForm>(
    job
      ? { title: job.title, area: job.area, description: job.description, requirements: job.requirements ?? '', benefits: job.benefits ?? '', employment: job.employment, workMode: job.workMode, salaryMin: centsToText(job.salaryMinCents), salaryMax: centsToText(job.salaryMaxCents), openings: String(job.openings), days: '30' }
      : emptyJob,
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = <K extends keyof JobForm>(k: K, val: JobForm[K]) => setV((p) => ({ ...p, [k]: val }))
  const save = useMutation({
    mutationFn: () => saveJob(businessId, v, job?.id ?? null),
    onSuccess: () => { toast.success(job ? 'Vaga atualizada.' : 'Vaga publicada.'); void qc.invalidateQueries({ queryKey: ['merchant', 'jobs', businessId] }); void qc.invalidateQueries({ queryKey: ['jobs'] }); onDone() },
    onError: (e) => toast.error(msg(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = jobFormSchema.safeParse(v)
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
    setErrors({})
    save.mutate()
  }
  const err = (k: string) => (errors[k] ? <p role="alert" className="mt-1 text-xs text-danger">{errors[k]}</p> : null)
  const input = (k: keyof JobForm, label: string, props: Record<string, unknown> = {}) => (
    <div><Label htmlFor={`jb-${k}`}>{label}</Label><input id={`jb-${k}`} value={v[k]} onChange={(e) => set(k, e.target.value as never)} aria-invalid={!!errors[k]} className={field} {...props} />{err(k)}</div>
  )
  return (
    <form onSubmit={submit} noValidate className={`${box} grid grid-cols-1 gap-3 md:grid-cols-2`}>
      {input('title', 'Cargo', { maxLength: 120 })}
      <div><Label htmlFor="jb-area">Área</Label><select id="jb-area" value={v.area} onChange={(e) => set('area', e.target.value as JobForm['area'])} className={field}>{jobAreas.map((a) => <option key={a} value={a}>{AREA_LABEL[a]}</option>)}</select></div>
      <div><Label htmlFor="jb-emp">Contratação</Label><select id="jb-emp" value={v.employment} onChange={(e) => set('employment', e.target.value as JobForm['employment'])} className={field}>{employments.map((a) => <option key={a} value={a}>{EMPLOYMENT_LABEL[a]}</option>)}</select></div>
      <div><Label htmlFor="jb-mode">Modelo</Label><select id="jb-mode" value={v.workMode} onChange={(e) => set('workMode', e.target.value as JobForm['workMode'])} className={field}>{workModes.map((a) => <option key={a} value={a}>{WORK_MODE_LABEL[a]}</option>)}</select></div>
      {input('salaryMin', 'Salário mínimo (R$, opcional)', { inputMode: 'decimal', placeholder: '1.800,00' })}
      {input('salaryMax', 'Salário máximo (R$, opcional)', { inputMode: 'decimal', placeholder: '2.200,00' })}
      {input('openings', 'Número de vagas', { inputMode: 'numeric' })}
      {input('days', 'Validade (dias, até 90)', { inputMode: 'numeric' })}
      <div className="md:col-span-2"><Label htmlFor="jb-desc">Descrição (atividades, horário, local)</Label><textarea id="jb-desc" maxLength={4000} value={v.description} onChange={(e) => set('description', e.target.value)} aria-invalid={!!errors.description} className={`${field} min-h-28 py-2`} />{err('description')}</div>
      <div><Label htmlFor="jb-req">Requisitos (opcional)</Label><textarea id="jb-req" maxLength={2000} value={v.requirements} onChange={(e) => set('requirements', e.target.value)} className={`${field} min-h-20 py-2`} /></div>
      <div><Label htmlFor="jb-ben">Benefícios (opcional)</Label><textarea id="jb-ben" maxLength={1000} value={v.benefits} onChange={(e) => set('benefits', e.target.value)} className={`${field} min-h-20 py-2`} /></div>
      <div className="flex gap-2 md:col-span-2">
        <button type="submit" disabled={save.isPending} className={primary}>{save.isPending ? 'Salvando…' : job ? 'Salvar vaga' : 'Publicar vaga'}</button>
        <button type="button" onClick={onDone} className={secondary}>Cancelar</button>
      </div>
      <p className="text-xs text-ink-muted md:col-span-2">Não peça dados sensíveis (religião, saúde, etc.) nem informe requisitos discriminatórios. Vagas irregulares podem ser encerradas pela Tucaí.</p>
    </form>
  )
}

function Applications({ jobId }: { jobId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['merchant', 'applications', jobId], queryFn: () => listJobApplications(jobId) })
  const change = useMutation({
    mutationFn: (a: { id: string; status: ApplicationStatus }) => updateApplicationStatus(a.id, a.status, a.status === 'interview' ? window.prompt('Recado para a pessoa (ex.: data e local da entrevista):') ?? '' : ''),
    onSuccess: () => { toast.success('Candidatura atualizada.'); void qc.invalidateQueries({ queryKey: ['merchant', 'applications', jobId] }) },
    onError: (e) => toast.error(msg(e)),
  })
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if ((q.data ?? []).length === 0) return <p className="text-sm text-ink-muted">{q.isLoading ? 'Carregando…' : 'Nenhuma candidatura ainda.'}</p>
  return (
    <ul className="divide-y divide-line">
      {(q.data ?? []).map((a) => {
        const tel = phoneDigits(a.phone)
        return (
          <li key={a.id} className="flex flex-col gap-1 py-3 text-sm">
            <p className="font-semibold text-ink">{a.fullName} <span className="font-normal text-ink-muted">· {APPLICATION_LABEL[a.status]} · {dateTime.format(new Date(a.createdAt))}</span></p>
            {tel && <a href={`tel:${tel}`} className="w-fit text-brand underline">{a.phone}</a>}
            {a.experience && <p className="whitespace-pre-line text-ink">{a.experience}</p>}
            {a.message && <p className="text-ink-muted">“{a.message}”</p>}
            {a.status !== 'withdrawn' && (
              <div className="flex flex-wrap gap-2">
                {(['reviewing', 'interview', 'hired', 'rejected'] as const).filter((s) => s !== a.status).map((s) => (
                  <button key={s} type="button" disabled={change.isPending} onClick={() => change.mutate({ id: a.id, status: s })} className={secondary}>{APPLICATION_LABEL[s]}</button>
                ))}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function JobsTab({ businessId, active }: { businessId: string; active: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['merchant', 'jobs', businessId], queryFn: () => listBusinessJobs(businessId) })
  const [editing, setEditing] = useState<Job | 'new' | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const status = useMutation({
    mutationFn: (a: { id: string; status: 'open' | 'paused' | 'closed' }) => setJobStatus(a.id, a.status),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['merchant', 'jobs', businessId] }); void qc.invalidateQueries({ queryKey: ['jobs'] }) },
    onError: (e) => toast.error(msg(e)),
  })
  if (!active) return <EmptyState icon={Briefcase} title="Vagas disponíveis após a aprovação" description="Quando o estabelecimento for aprovado, você poderá publicar vagas aqui." />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  return (
    <div className="flex flex-col gap-3">
      {editing ? (
        <JobEditor businessId={businessId} job={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" onClick={() => setEditing('new')} className={`${primary} w-fit`}><Plus aria-hidden="true" className="size-4" />Nova vaga</button>
      )}
      {(q.data ?? []).length === 0 ? (
        <EmptyState icon={Briefcase} title={q.isLoading ? 'Carregando…' : 'Nenhuma vaga publicada'} description="Vagas aparecem para toda a cidade na aba Vagas." />
      ) : (
        <ul className="flex flex-col gap-3">
          {(q.data ?? []).map((j) => {
            const expired = new Date(j.expiresAt) < new Date()
            return (
              <li key={j.id} className={`${box} flex flex-col gap-2`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-ink">{j.title}</h3>
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink">{expired && j.status === 'open' ? 'Expirada' : JOB_STATUS_LABEL[j.status]}</span>
                </div>
                <p className="text-xs text-ink-muted">{EMPLOYMENT_LABEL[j.employment]} · {AREA_LABEL[j.area]} · até {dateTime.format(new Date(j.expiresAt)).split(' ')[0]}{j.closedReason ? ` · ${j.closedReason}` : ''}</p>
                {j.status !== 'closed' && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setEditing(j)} className={secondary}>{expired ? 'Editar e renovar' : 'Editar'}</button>
                    {j.status === 'open' ? (
                      <button type="button" disabled={status.isPending} onClick={() => status.mutate({ id: j.id, status: 'paused' })} className={secondary}>Pausar</button>
                    ) : (
                      <button type="button" disabled={status.isPending} onClick={() => status.mutate({ id: j.id, status: 'open' })} className={secondary}>Reabrir</button>
                    )}
                    <button type="button" disabled={status.isPending} onClick={() => { if (window.confirm('Encerrar esta vaga? Não será possível reabrir.')) status.mutate({ id: j.id, status: 'closed' }) }} className={secondary}>Encerrar</button>
                  </div>
                )}
                <button type="button" aria-expanded={open === j.id} onClick={() => setOpen(open === j.id ? null : j.id)} className="w-fit text-sm font-semibold text-brand underline">
                  {open === j.id ? 'Ocultar candidaturas' : 'Ver candidaturas'}
                </button>
                {open === j.id && <Applications jobId={j.id} />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------- Plano e pagamentos ----------
export function PlanTab({ businessId }: { businessId: string }) {
  const toast = useToast()
  const [params] = useSearchParams()
  const q = useQuery({ queryKey: ['merchant', 'plan', businessId], queryFn: () => getMyPlan(businessId) })
  const pay = useMutation({
    mutationFn: createPaymentLink,
    onSuccess: (url) => window.location.assign(url),
    onError: (e) => toast.error(msg(e)),
  })
  const result = params.get('pagamento')
  const dateBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const s = q.data?.subscription
  const open = (q.data?.charges ?? []).filter((c) => c.status === 'aberta')
  const history = (q.data?.charges ?? []).filter((c) => c.status !== 'aberta')
  return (
    <div className="flex flex-col gap-3">
      {result === 'aprovado' && <p role="status" className="rounded-card border border-success bg-surface p-3 text-sm text-ink">Pagamento aprovado. A confirmação chega em instantes e o plano é renovado automaticamente.</p>}
      {result === 'pendente' && <p role="status" className="rounded-card border border-line bg-surface p-3 text-sm text-ink">Pagamento em processamento (Pix ou boleto). Assim que o Mercado Pago confirmar, a cobrança é baixada sozinha.</p>}
      {result === 'recusado' && <p role="alert" className="rounded-card border border-danger bg-surface p-3 text-sm text-ink">O pagamento não foi concluído. Você pode tentar de novo.</p>}
      <section className={box}>
        <h3 className="mb-1 text-base font-semibold text-ink">Seu plano</h3>
        {!q.data ? (
          <p className="text-sm text-ink-muted">Carregando…</p>
        ) : s ? (
          <p className="text-sm text-ink">
            <strong>{s.planName}</strong> · {formatBRL(s.priceCents)}/mês · desde {dateBr(s.startedOn)} · <strong>vence em {dateBr(s.periodEnd)}</strong>
          </p>
        ) : (
          <p className="text-sm text-ink-muted">Nenhum plano ativo. A Tucaí entra em contato para combinar o plano do seu estabelecimento.</p>
        )}
      </section>
      <section className={box}>
        <h3 className="mb-2 text-base font-semibold text-ink">Cobranças em aberto</h3>
        {open.length === 0 ? (
          <p className="text-sm text-ink-muted">{q.data ? 'Nenhuma cobrança em aberto.' : 'Carregando…'}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {open.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 rounded-xl border border-line p-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-ink">{c.description} · <strong>{formatBRL(c.amountCents)}</strong> · vence {dateBr(c.dueOn)}</span>
                <button type="button" disabled={pay.isPending} onClick={() => pay.mutate(c.id)} className={primary}>{pay.isPending ? 'Abrindo…' : 'Pagar com Mercado Pago'}</button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-muted">Pix, cartão ou boleto pelo Mercado Pago. A Tucaí não vê os dados do seu cartão.</p>
      </section>
      {history.length > 0 && (
        <section className={box}>
          <h3 className="mb-2 text-base font-semibold text-ink">Histórico</h3>
          <ul className="divide-y divide-line text-sm">
            {history.map((c) => (
              <li key={c.id} className="flex justify-between gap-2 py-2"><span>{c.description}</span><span>{formatBRL(c.amountCents)} · {c.status === 'paga' ? `pago em ${c.paidAt ? dateBr(c.paidAt) : ''}` : 'cancelada'}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
