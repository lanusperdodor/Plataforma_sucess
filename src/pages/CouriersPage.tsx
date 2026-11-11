import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bike, CheckCircle2, Clock, FileCheck2, PauseCircle, ShieldCheck, Wallet, XCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { LoginInvite } from '../components/feedback/LoginInvite.tsx'
import { useToast } from '../components/feedback/toast-context.ts'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { useCities } from '../features/catalog/hooks.ts'
import {
  VEHICLE_LABEL,
  courierFormSchema,
  getMyCourier,
  submitCourierApplication,
  vehicles,
  type CourierForm,
  type MyCourier,
} from '../features/courier/repository.ts'

const STEPS = [
  { icon: FileCheck2, title: 'Cadastro', text: 'Seus dados de contato, cidade e veículo.' },
  { icon: ShieldCheck, title: 'Análise pela Tucaí', text: 'A equipe confere as informações antes de liberar o acesso.' },
  { icon: Wallet, title: 'Ofertas com valor antes do aceite', text: 'Você vê origem, destino e valor previsto e decide se aceita.' },
]

const STATUS = {
  pending: { icon: Clock, tone: 'text-warm', title: 'Cadastro em análise', text: 'A equipe Tucaí vai analisar seus dados. Você será avisado aqui.' },
  approved: { icon: CheckCircle2, tone: 'text-success', title: 'Cadastro aprovado', text: 'Sua área de entregador está liberada.' },
  rejected: { icon: XCircle, tone: 'text-danger', title: 'Cadastro não aprovado', text: 'Corrija os dados e envie novamente.' },
  suspended: { icon: PauseCircle, tone: 'text-danger', title: 'Cadastro suspenso', text: 'Fale com o suporte da Tucaí.' },
} as const

const field = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink'

function StatusCard({ c }: { c: MyCourier }) {
  const s = STATUS[c.status]
  return (
    <section aria-labelledby="ent-status" className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 md:p-6">
      <h2 id="ent-status" className={`inline-flex items-center gap-2 text-lg font-semibold ${s.tone}`}><s.icon aria-hidden="true" className="size-5" />{s.title}</h2>
      <p className="text-sm text-ink-muted">{s.text}</p>
      <p className="text-sm text-ink">{c.fullName} · {VEHICLE_LABEL[c.vehicle]}{c.plate ? ` · ${c.plate}` : ''}</p>
      {c.reviewNote && c.status !== 'approved' && <p className="text-sm text-ink">Motivo informado: {c.reviewNote}</p>}
      {c.status === 'approved' && (
        <Link to="/entregador" className="pressable inline-flex min-h-11 w-fit items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">Abrir área do entregador</Link>
      )}
    </section>
  )
}

function ApplicationForm({ existing }: { existing: MyCourier | null }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { refreshAuthz } = useAuth()
  const cities = useCities()
  const [v, setV] = useState<CourierForm>({
    fullName: existing?.fullName ?? '',
    phone: existing?.phone ?? '',
    cityId: existing?.cityId ?? '',
    vehicle: existing?.vehicle ?? 'moto',
    plate: existing?.plate ?? '',
    cnh: existing?.cnh ?? '',
    acceptTerms: false,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const m = useMutation({
    mutationFn: () => submitCourierApplication(v),
    onSuccess: () => {
      toast.success('Cadastro enviado para análise.')
      void qc.invalidateQueries({ queryKey: ['courier'] })
      void refreshAuthz()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível enviar.'),
  })
  const set = <K extends keyof CourierForm>(k: K, val: CourierForm[K]) => setV((p) => ({ ...p, [k]: val }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = courierFormSchema.safeParse(v)
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
    setErrors({})
    m.mutate()
  }
  const err = (k: string) => (errors[k] ? <p role="alert" className="mt-1 text-xs text-danger">{errors[k]}</p> : null)
  const motorized = v.vehicle === 'moto' || v.vehicle === 'carro'
  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 rounded-card border border-line bg-surface p-4 md:grid-cols-2 md:p-6">
      <h2 className="text-lg font-semibold text-ink md:col-span-2">{existing ? 'Reenviar cadastro' : 'Cadastro de entregador'}</h2>
      <div>
        <label htmlFor="ent-nome" className="mb-1 block text-sm font-medium text-ink">Nome completo</label>
        <input id="ent-nome" autoComplete="name" value={v.fullName} onChange={(e) => set('fullName', e.target.value)} className={field} />
        {err('fullName')}
      </div>
      <div>
        <label htmlFor="ent-tel" className="mb-1 block text-sm font-medium text-ink">Celular (WhatsApp)</label>
        <input id="ent-tel" type="tel" autoComplete="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} className={field} />
        {err('phone')}
      </div>
      <div>
        <label htmlFor="ent-cidade" className="mb-1 block text-sm font-medium text-ink">Cidade onde vai atuar</label>
        <select id="ent-cidade" value={v.cityId} onChange={(e) => set('cityId', e.target.value)} className={field}>
          <option value="">{cities.isLoading ? 'Carregando…' : 'Escolha'}</option>
          {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}, {c.state}</option>)}
        </select>
        {err('cityId')}
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">Veículo</legend>
        <div className="flex flex-wrap gap-2">
          {vehicles.map((x) => (
            <label key={x} className={`pressable inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${v.vehicle === x ? 'border-brand font-semibold text-brand' : 'border-line text-ink'}`}>
              <input type="radio" name="ent-veiculo" className="sr-only" checked={v.vehicle === x} onChange={() => set('vehicle', x)} />
              {VEHICLE_LABEL[x]}
            </label>
          ))}
        </div>
      </fieldset>
      {motorized && (
        <>
          <div>
            <label htmlFor="ent-placa" className="mb-1 block text-sm font-medium text-ink">Placa</label>
            <input id="ent-placa" autoCapitalize="characters" value={v.plate} onChange={(e) => set('plate', e.target.value)} placeholder="ABC1D23" className={field} />
            {err('plate')}
          </div>
          <div>
            <label htmlFor="ent-cnh" className="mb-1 block text-sm font-medium text-ink">Categoria da CNH</label>
            <select id="ent-cnh" value={v.cnh} onChange={(e) => set('cnh', e.target.value)} className={field}>
              <option value="">Escolha</option>
              {['A', 'B', 'AB', 'AC', 'AD', 'AE'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {err('cnh')}
          </div>
        </>
      )}
      <label className="flex min-h-11 items-start gap-2 text-sm text-ink md:col-span-2">
        <input type="checkbox" className="mt-0.5 size-5" checked={v.acceptTerms} onChange={(e) => set('acceptTerms', e.target.checked)} />
        <span>Li e aceito os <Link to="/termos" className="font-semibold text-brand underline">termos de parceria</Link>. Sou parceiro independente, sem vínculo empregatício.</span>
      </label>
      {err('acceptTerms')}
      <p className="text-xs text-ink-muted md:col-span-2">Pedimos só o necessário para a análise. O envio de documentos será solicitado aqui quando estiver disponível.</p>
      <div className="md:col-span-2">
        <button type="submit" disabled={m.isPending} className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-6 text-sm font-semibold text-ink disabled:opacity-50">
          {m.isPending ? 'Enviando…' : 'Enviar cadastro'}
        </button>
      </div>
    </form>
  )
}

/** Cadastro de entregadores parceiros (independentes) com análise pela equipe Tucaí. */
export function CouriersPage() {
  const { session } = useAuth()
  const userId = session?.user.id
  const mine = useQuery({ queryKey: ['courier', 'me', userId ?? ''], queryFn: () => getMyCourier(userId!), enabled: !!userId })
  return (
    <Page>
      <PageHeader icon={Bike} title="Entregadores parceiros" subtitle="Faça entregas na sua cidade com a Tucaí, no seu horário." />
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
            <Icon aria-hidden="true" className="size-6 text-brand" />
            <p className="text-sm font-semibold text-ink">{title}</p>
            <p className="text-sm text-ink-muted">{text}</p>
          </li>
        ))}
      </ol>
      {!session ? (
        <LoginInvite icon={Bike} title="Entre para se cadastrar" description="Use sua conta Tucaí ou crie uma em poucos segundos." />
      ) : mine.isError ? (
        <ErrorState error={mine.error} onRetry={() => void mine.refetch()} />
      ) : mine.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : (
        <>
          {mine.data && <StatusCard c={mine.data} />}
          {(!mine.data || mine.data.status === 'rejected') && <ApplicationForm existing={mine.data ?? null} />}
        </>
      )}
      <p className="text-xs text-ink-muted">Entregadores são parceiros independentes. As condições de parceria estão nos termos de uso e passam por revisão jurídica.</p>
    </Page>
  )
}
