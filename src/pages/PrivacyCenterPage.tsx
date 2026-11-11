import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, LogOut, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { useToast } from '../components/feedback/toast-context.ts'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import {
  PRIVACY_KIND_LABEL,
  PRIVACY_STATUS_LABEL,
  exportMyData,
  listMyPrivacyRequests,
  privacyKinds,
  submitPrivacyRequest,
  type PrivacyKind,
} from '../features/privacy/repository.ts'

const box = 'rounded-card border border-line bg-surface p-4 md:p-6'
const btn = 'pressable inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold disabled:opacity-50'
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Algo deu errado. Tente novamente.')

/** Gera o download de um JSON sem passar por servidores de terceiros. */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function ExportCard() {
  const toast = useToast()
  const m = useMutation({
    mutationFn: exportMyData,
    onSuccess: (data) => {
      downloadJson(data, `tucai-meus-dados-${new Date().toISOString().slice(0, 10)}.json`)
      toast.success('Arquivo com seus dados gerado.')
    },
    onError: (e) => toast.error(msg(e)),
  })
  return (
    <section aria-labelledby="pc-export" className={box}>
      <h2 id="pc-export" className="text-lg font-semibold text-ink">Baixar meus dados</h2>
      <p className="mb-3 text-sm text-ink-muted">Cópia em JSON de tudo o que a Tucaí guarda sobre você (acesso e portabilidade). Senhas nunca são exportadas.</p>
      <button type="button" onClick={() => m.mutate()} disabled={m.isPending} className={`${btn} bg-brand text-surface`}>
        <Download aria-hidden="true" className="size-4" />
        {m.isPending ? 'Gerando…' : 'Baixar arquivo'}
      </button>
    </section>
  )
}

function RequestCard({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [kind, setKind] = useState<PrivacyKind>('access')
  const [details, setDetails] = useState('')
  const [error, setError] = useState<string>()
  const list = useQuery({ queryKey: ['privacy', 'mine', userId], queryFn: () => listMyPrivacyRequests(userId) })
  const m = useMutation({
    mutationFn: () => submitPrivacyRequest(kind, details),
    onSuccess: () => {
      toast.success('Solicitação registrada. Você acompanha o resultado aqui.')
      setDetails('')
      void qc.invalidateQueries({ queryKey: ['privacy', 'mine'] })
    },
    onError: (e) => setError(msg(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    m.mutate()
  }
  return (
    <section aria-labelledby="pc-req" className={box}>
      <h2 id="pc-req" className="text-lg font-semibold text-ink">Solicitações de privacidade</h2>
      <p className="mb-3 text-sm text-ink-muted">
        Pedidos de exclusão anonimizam seu perfil; dados que a lei obriga a manter (por exemplo, fiscais) são preservados pelo prazo legal.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label htmlFor="pc-kind" className="mb-1 block text-sm font-medium text-ink">Tipo de pedido</label>
          <select id="pc-kind" value={kind} onChange={(e) => setKind(e.target.value as PrivacyKind)} className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink">
            {privacyKinds.map((k) => <option key={k} value={k}>{PRIVACY_KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pc-details" className="mb-1 block text-sm font-medium text-ink">Detalhes (opcional)</label>
          <textarea id="pc-details" maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} className="min-h-24 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink" />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={m.isPending} className={`${btn} w-fit bg-orange text-ink`}>{m.isPending ? 'Enviando…' : 'Enviar solicitação'}</button>
      </form>
      <h3 className="mb-2 mt-6 text-sm font-semibold text-ink">Histórico</h3>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (list.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">{list.isLoading ? 'Carregando…' : 'Nenhuma solicitação.'}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(list.data ?? []).map((r) => (
            <li key={r.id} className="rounded-xl border border-line p-3 text-sm">
              <p className="font-semibold text-ink">{PRIVACY_KIND_LABEL[r.kind]} · {PRIVACY_STATUS_LABEL[r.status]}</p>
              <p className="text-ink-muted">Enviada em {dateFmt.format(new Date(r.createdAt))}{r.resolvedAt ? ` · encerrada em ${dateFmt.format(new Date(r.resolvedAt))}` : ''}</p>
              {r.resolutionNote && <p className="text-ink">Resposta: {r.resolutionNote}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SessionsCard() {
  const { signOutEverywhere } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  return (
    <section aria-labelledby="pc-sess" className={box}>
      <h2 id="pc-sess" className="text-lg font-semibold text-ink">Sessões</h2>
      <p className="mb-3 text-sm text-ink-muted">Perdeu o celular ou usou um computador público? Encerre o acesso em todos os aparelhos.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void signOutEverywhere().then(({ error }) => {
            setBusy(false)
            if (error) toast.error('Não foi possível encerrar as sessões. Tente novamente.')
            else navigate('/entrar', { replace: true })
          })
        }}
        className={`${btn} border border-danger text-danger`}
      >
        <LogOut aria-hidden="true" className="size-4" />
        Sair de todos os dispositivos
      </button>
    </section>
  )
}

/** Central do titular: acesso/portabilidade, solicitações LGPD e revogação de sessões. */
export function PrivacyCenterPage() {
  const { session } = useAuth()
  return (
    <Page>
      <Link to="/perfil" className="pressable inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-ink"><ArrowLeft aria-hidden="true" className="size-4" />Perfil</Link>
      <PageHeader icon={ShieldCheck} title="Privacidade e dados" subtitle="Seus direitos como titular de dados (LGPD)." />
      <ExportCard />
      {session && <RequestCard userId={session.user.id} />}
      <SessionsCard />
      <p className="text-sm text-ink-muted">
        Saiba mais na <Link to="/privacidade" className="font-semibold text-brand underline">Política de privacidade</Link>.
      </p>
    </Page>
  )
}
