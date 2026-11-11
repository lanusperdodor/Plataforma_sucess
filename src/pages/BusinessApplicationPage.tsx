import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Briefcase, CheckCircle2, Clock, PauseCircle, XCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { useToast } from '../components/feedback/toast-context.ts'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import {
  applicationSchema,
  listMyBusinesses,
  submitApplication,
  type ApplicationInput,
  type MyBusiness,
} from '../features/business/repository.ts'
import { useCategories, useCities } from '../features/catalog/hooks.ts'

const TYPES = [
  { value: 'restaurante', label: 'Restaurante' },
  { value: 'loja', label: 'Loja' },
  { value: 'servico', label: 'Serviço' },
] as const

const STATUS: Record<MyBusiness['status'], { label: string; icon: typeof Clock; tone: string; text: string }> = {
  pending: { label: 'Em análise', icon: Clock, tone: 'text-warm', text: 'A equipe Tucaí vai analisar sua solicitação.' },
  active: { label: 'Aprovado', icon: CheckCircle2, tone: 'text-success', text: 'Seu negócio está publicado na Tucaí.' },
  rejected: { label: 'Recusado', icon: XCircle, tone: 'text-danger', text: 'A solicitação não foi aprovada.' },
  suspended: { label: 'Suspenso', icon: PauseCircle, tone: 'text-danger', text: 'O negócio está temporariamente fora do ar.' },
}

const field = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink'
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })

function MyBusinesses({ items }: { items: MyBusiness[] }) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="meus-negocios" className="flex flex-col gap-3">
      <h2 id="meus-negocios" className="text-lg font-semibold text-ink">Meus negócios</h2>
      <ul className="flex flex-col gap-2">
        {items.map((b) => {
          const s = STATUS[b.status]
          return (
            <li key={b.id} className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-ink">{b.name}</span>
                <span className={`inline-flex items-center gap-1 text-sm font-semibold ${s.tone}`}>
                  <s.icon aria-hidden="true" className="size-4" />
                  {s.label}
                </span>
              </div>
              <p className="text-sm text-ink-muted">
                {s.text} Enviado em {dateFmt.format(new Date(b.submittedAt))}.
              </p>
              {b.reviewNote && (b.status === 'rejected' || b.status === 'suspended') && (
                <p className="text-sm text-ink">Motivo informado: {b.reviewNote}</p>
              )}
              {b.status !== 'rejected' && (
                <p className="text-sm text-ink-muted">
                  <Link to={`/painel/${b.id}`} className="font-semibold text-brand underline">Abrir painel do estabelecimento</Link>
                  {b.status === 'active' && (
                    <>
                      {' · '}
                      <Link to={`/${b.businessType === 'restaurante' ? 'restaurantes' : b.businessType === 'loja' ? 'lojas' : 'servicos'}/${b.slug}`} className="font-semibold text-brand underline">
                        Ver página pública
                      </Link>
                    </>
                  )}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ApplicationForm() {
  const qc = useQueryClient()
  const { refreshAuthz } = useAuth()
  const toast = useToast()
  const cities = useCities()
  const [values, setValues] = useState<ApplicationInput>({ name: '', businessType: 'restaurante', cityId: '', categoryId: '', phone: '', addressLine: '', description: '' })
  const categories = useCategories(values.businessType)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string>()
  const set = <K extends keyof ApplicationInput>(k: K, v: ApplicationInput[K]) => setValues((p) => ({ ...p, [k]: v }))
  const m = useMutation({
    mutationFn: submitApplication,
    onSuccess: () => {
      toast.success('Solicitação enviada! Você será avisado do resultado nesta página.')
      setValues((p) => ({ ...p, name: '', phone: '', addressLine: '', description: '', categoryId: '' }))
      void qc.invalidateQueries({ queryKey: ['business', 'mine'] })
      void qc.invalidateQueries({ queryKey: ['merchant'] })
      void refreshAuthz()
    },
    onError: (e) => setServerError(e instanceof Error ? e.message : 'Não foi possível enviar.'),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setServerError(undefined)
    const parsed = applicationSchema.safeParse(values)
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    setErrors({})
    m.mutate(values)
  }
  const err = (k: string) => (errors[k] ? <p id={`err-${k}`} role="alert" className="mt-1 text-xs text-danger">{errors[k]}</p> : null)
  const cityList = cities.data ?? []

  return (
    <section aria-labelledby="nova-solicitacao" className="rounded-card border border-line bg-surface p-4 md:p-6">
      <h2 id="nova-solicitacao" className="text-lg font-semibold text-ink">Nova solicitação</h2>
      <p className="mb-4 text-sm text-ink-muted">Seu negócio só aparece para os clientes depois da aprovação da equipe Tucaí.</p>
      {cities.isError ? (
        <ErrorState error={cities.error} onRetry={() => void cities.refetch()} />
      ) : (
        <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor="ap-name" className="mb-1 block text-sm font-medium text-ink">Nome do negócio</label>
            <input id="ap-name" value={values.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'err-name' : undefined} maxLength={120} className={field} />
            {err('name')}
          </div>
          <fieldset className="md:col-span-2">
            <legend className="mb-1 text-sm font-medium text-ink">Tipo</legend>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((t) => (
                <label key={t.value} className={`pressable inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm ${values.businessType === t.value ? 'border-brand font-semibold text-brand' : 'border-line text-ink'}`}>
                  <input type="radio" name="ap-type" value={t.value} checked={values.businessType === t.value} onChange={() => setValues((p) => ({ ...p, businessType: t.value, categoryId: '' }))} className="sr-only" />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="ap-city" className="mb-1 block text-sm font-medium text-ink">Cidade</label>
            <select id="ap-city" value={values.cityId} onChange={(e) => set('cityId', e.target.value)} aria-invalid={!!errors.cityId} className={field} disabled={cities.isLoading}>
              <option value="">{cities.isLoading ? 'Carregando…' : cityList.length === 0 ? 'Nenhuma cidade ativa' : 'Escolha'}</option>
              {cityList.map((c) => <option key={c.id} value={c.id}>{c.name}, {c.state}</option>)}
            </select>
            {err('cityId')}
          </div>
          <div>
            <label htmlFor="ap-cat" className="mb-1 block text-sm font-medium text-ink">Categoria (opcional)</label>
            <select id="ap-cat" value={values.categoryId} onChange={(e) => set('categoryId', e.target.value)} className={field}>
              <option value="">Escolha</option>
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ap-phone" className="mb-1 block text-sm font-medium text-ink">Telefone / WhatsApp</label>
            <input id="ap-phone" type="tel" autoComplete="tel" value={values.phone} onChange={(e) => set('phone', e.target.value)} aria-invalid={!!errors.phone} className={field} />
            {err('phone')}
          </div>
          <div>
            <label htmlFor="ap-addr" className="mb-1 block text-sm font-medium text-ink">Endereço</label>
            <input id="ap-addr" autoComplete="street-address" value={values.addressLine} onChange={(e) => set('addressLine', e.target.value)} maxLength={200} className={field} />
            {err('addressLine')}
          </div>
          <div className="md:col-span-2">
            <label htmlFor="ap-desc" className="mb-1 block text-sm font-medium text-ink">Descrição (opcional)</label>
            <textarea id="ap-desc" value={values.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} className={`${field} min-h-24 py-2`} />
            {err('description')}
          </div>
          {serverError && <p role="alert" className="text-sm text-danger md:col-span-2">{serverError}</p>}
          <div className="md:col-span-2">
            <button type="submit" disabled={m.isPending} className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-6 text-sm font-semibold text-ink disabled:opacity-50">
              {m.isPending ? 'Enviando…' : 'Enviar solicitação'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

/** Cadastro de estabelecimento pelo próprio comerciante; aprovação no Painel Master. */
export function BusinessApplicationPage() {
  const { session } = useAuth()
  const userId = session?.user.id
  const mine = useQuery({
    queryKey: ['business', 'mine', userId ?? ''],
    queryFn: () => listMyBusinesses(userId!),
    enabled: !!userId,
  })
  return (
    <Page>
      <PageHeader icon={Briefcase} title="Meu negócio na Tucaí" subtitle="Restaurantes, lojas e prestadores de serviço da região." />
      {mine.isError ? <ErrorState error={mine.error} onRetry={() => void mine.refetch()} /> : <MyBusinesses items={mine.data ?? []} />}
      <ApplicationForm />
      <p className="text-xs text-ink-muted">
        Nenhuma cobrança é feita no envio da solicitação. Planos e condições comerciais são apresentados após a aprovação.
      </p>
    </Page>
  )
}
