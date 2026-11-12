import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { listSettings, setSetting } from '../../features/admin/repository.ts'
import { enrollTotp, getMfaStatus, removeFactor, verifyTotp, type TotpEnrollment } from '../../features/admin/mfa/repository.ts'
import { useAdminAccess } from './access-context.ts'
import { AdminHeader, errorMessage, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

function CodeForm({ factorId, onVerified, label }: { factorId: string; onVerified: () => void; label: string }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string>()
  const m = useMutation({
    mutationFn: () => verifyTotp(factorId, code.trim()),
    onSuccess: onVerified,
    onError: (e) => setError(errorMessage(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    m.mutate()
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div>
        <label htmlFor={`mfa-${factorId}`} className="mb-1 block text-sm font-medium text-ink">{label}</label>
        <input
          id={`mfa-${factorId}`}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className={`${inputClass} w-40 tracking-[0.3em]`}
        />
      </div>
      <button type="submit" disabled={m.isPending || code.length !== 6} className={primaryButton}>
        {m.isPending ? 'Verificando…' : 'Verificar'}
      </button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </form>
  )
}

function MfaPanel() {
  const qc = useQueryClient()
  const toast = useToast()
  const status = useQuery({ queryKey: ['admin', 'mfa'], queryFn: getMfaStatus })
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const enroll = useMutation({ mutationFn: enrollTotp, onSuccess: setEnrollment, onError: (e) => toast.error(errorMessage(e)) })
  const remove = useMutation({
    mutationFn: removeFactor,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const verified = () => {
    toast.success('Verificação em duas etapas confirmada nesta sessão.')
    setEnrollment(null)
    void qc.invalidateQueries({ queryKey: ['admin'] })
  }

  if (status.isLoading) return <p role="status" className="text-sm text-ink-muted">Carregando…</p>
  if (status.isError) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />
  const s = status.data!
  const verifiedFactor = s.factors.find((f) => f.status === 'verified')
  const unverified = s.factors.filter((f) => f.status === 'unverified')

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        {s.currentLevel === 'aal2' ? (
          <ShieldCheck aria-hidden="true" className="size-6 shrink-0 text-success" />
        ) : (
          <ShieldAlert aria-hidden="true" className="size-6 shrink-0 text-warm" />
        )}
        <div>
          <h2 className="text-base font-bold text-ink">Verificação em duas etapas (MFA)</h2>
          <p className="text-sm text-ink-muted">
            {s.currentLevel === 'aal2'
              ? 'Esta sessão está verificada com o segundo fator.'
              : verifiedFactor
                ? 'Você já tem um autenticador. Confirme o código para verificar esta sessão.'
                : 'Use um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password etc.).'}
          </p>
        </div>
      </div>

      {verifiedFactor && s.currentLevel !== 'aal2' && (
        <CodeForm factorId={verifiedFactor.id} onVerified={verified} label="Código do autenticador" />
      )}

      {!verifiedFactor && !enrollment && (
        <button type="button" onClick={() => enroll.mutate()} disabled={enroll.isPending} className={`${primaryButton} w-fit`}>
          <KeyRound aria-hidden="true" className="size-4" />
          {enroll.isPending ? 'Preparando…' : 'Ativar autenticador'}
        </button>
      )}

      {enrollment && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink">1. Escaneie o QR Code no aplicativo autenticador.</p>
          <img src={enrollment.qrCode} alt="QR Code para cadastrar o autenticador" width={180} height={180} className="size-44 rounded-xl border border-line bg-white p-2" />
          <p className="text-sm text-ink">
            Sem câmera? Digite a chave: <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{enrollment.secret}</code>
          </p>
          <CodeForm factorId={enrollment.factorId} onVerified={verified} label="2. Digite o código de 6 números" />
        </div>
      )}

      {unverified.length > 0 && !enrollment && (
        <div className="text-sm text-ink-muted">
          Há cadastros de autenticador não concluídos.{' '}
          {unverified.map((f) => (
            <button key={f.id} type="button" onClick={() => remove.mutate(f.id)} className="font-semibold text-brand underline">
              Remover pendente
            </button>
          ))}
        </div>
      )}
    </Panel>
  )
}

function SettingsPanel() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: listSettings })
  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => setSetting(key, value),
    onSuccess: () => {
      toast.success('Configuração salva e registrada na auditoria.')
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const [maxPending, setMaxPending] = useState<string>()
  if (q.isLoading) return <p role="status" className="text-sm text-ink-muted">Carregando…</p>
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const get = (k: string) => q.data?.find((s) => s.key === k)?.value
  const mfaRequired = get('require_admin_mfa') === true
  const pending = maxPending ?? String(get('max_pending_business_applications') ?? '')
  return (
    <Panel className="flex flex-col gap-4">
      <h2 className="text-base font-bold text-ink">Configurações operacionais</h2>
      <label className="flex min-h-11 items-start gap-3 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-0.5 size-5"
          checked={mfaRequired}
          disabled={save.isPending}
          onChange={(e) => save.mutate({ key: 'require_admin_mfa', value: e.target.checked })}
        />
        <span>
          <span className="font-semibold">Exigir MFA de toda a equipe administrativa</span>
          <span className="block text-ink-muted">Ligado por padrão. Para religar depois de desligado, verifique primeiro o seu próprio MFA. Toda mudança fica na auditoria.</span>
        </span>
      </label>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate({ key: 'max_pending_business_applications', value: Number(pending) })
        }}
      >
        <div>
          <label htmlFor="max-pending" className="mb-1 block text-sm font-medium text-ink">Solicitações de cadastro em análise por usuário</label>
          <input id="max-pending" type="number" min={1} max={20} required value={pending} onChange={(e) => setMaxPending(e.target.value)} className={`${inputClass} w-28`} />
        </div>
        <button type="submit" disabled={save.isPending} className={secondaryButton}>Salvar limite</button>
      </form>
    </Panel>
  )
}

export function AdminSecurity() {
  const access = useAdminAccess()
  return (
    <>
      <AdminHeader title="Segurança" subtitle="Verificação em duas etapas e configurações sensíveis." />
      {!access.mfaOk && (
        <p role="alert" className="mb-4 rounded-card border border-line bg-warm-soft p-3 text-sm text-ink">
          A Tucaí exige verificação em duas etapas para a equipe. Confirme seu autenticador para liberar o painel.
        </p>
      )}
      <div className="flex flex-col gap-4">
        <MfaPanel />
        {access.isMaster && access.mfaOk && <SettingsPanel />}
      </div>
    </>
  )
}
