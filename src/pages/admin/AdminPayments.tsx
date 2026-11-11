import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Copy, CreditCard, KeyRound, PlugZap } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { generateIntegrationKey, getGateway, saveGateway } from '../../features/admin/repository.ts'
import { testGateway, type GatewayStatus } from '../../features/payments/repository.ts'
import { useAdminAccess } from './access-context.ts'
import { AdminHeader, errorMessage, formatDateTime, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

const copy = (text: string, done: () => void) => void navigator.clipboard?.writeText(text).then(done, () => undefined)

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-surface">{n}</span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-ink">{title}</p>
        <div className="mt-1 text-ink-muted">{children}</div>
      </div>
    </li>
  )
}

/** Configuração do Mercado Pago (credenciais ficam no banco, fora do alcance do site; o servidor usa). */
export function AdminPayments() {
  const access = useAdminAccess()
  const canEdit = access.isMaster && access.mfaOk
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['admin', 'gateway'], queryFn: getGateway })
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [accessToken, setAccessToken] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [status, setStatus] = useState<GatewayStatus | null>(null)
  const webhookUrl = `${window.location.origin}/api/pagamentos/webhook`
  const g = q.data
  const pk = publicKey ?? g?.publicKey ?? ''
  const on = enabled ?? g?.enabled ?? false

  const save = useMutation({
    mutationFn: () => saveGateway({ publicKey: pk === (g?.publicKey ?? '') ? '' : pk, accessToken, webhookSecret, enabled: on }),
    onSuccess: () => {
      toast.success('Configuração salva.')
      setAccessToken('')
      setWebhookSecret('')
      setPublicKey(null)
      setEnabled(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'gateway'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const genKey = useMutation({
    mutationFn: generateIntegrationKey,
    onSuccess: (k) => {
      setNewKey(k)
      void qc.invalidateQueries({ queryKey: ['admin', 'gateway'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const test = useMutation({ mutationFn: testGateway, onSuccess: setStatus, onError: (e) => toast.error(errorMessage(e)) })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  return (
    <div className="flex flex-col gap-6">
      <AdminHeader title="Pagamentos" subtitle="Mercado Pago para receber mensalidades e cobranças das empresas (Pix, cartão e boleto)." />

      <Panel className="flex flex-wrap items-center gap-3 text-sm">
        <CreditCard aria-hidden="true" className="size-5 text-ink" />
        <span className="font-semibold text-ink">Mercado Pago</span>
        {!g ? (
          <span className="text-ink-muted">Carregando…</span>
        ) : (
          <>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${g.enabled ? 'bg-success/10 text-success' : 'bg-muted text-ink-muted'}`}>{g.enabled ? 'Ativo' : 'Desativado'}</span>
            {g.mode && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${g.mode === 'teste' ? 'bg-orange/15 text-accent' : 'bg-brand text-surface'}`}>Ambiente de {g.mode}</span>}
            <span className="text-ink-muted">Access Token: {g.tokenSet ? `•••• ${g.tokenLast4}` : 'não cadastrado'}</span>
            <span className="text-ink-muted">Chave de integração: {g.integrationKeySet ? 'gerada' : 'não gerada'}</span>
            {g.updatedAt && <span className="text-xs text-ink-muted">atualizado em {formatDateTime(g.updatedAt)}</span>}
          </>
        )}
        <button type="button" disabled={test.isPending} onClick={() => test.mutate()} className={`${secondaryButton} ml-auto`}>
          <PlugZap aria-hidden="true" className="size-4" />{test.isPending ? 'Testando…' : 'Testar conexão'}
        </button>
        {status && (
          <p role="status" className={`w-full text-sm ${status.ok ? 'text-success' : 'text-danger'}`}>
            {status.ok ? <><CheckCircle2 aria-hidden="true" className="mr-1 inline size-4" />Conectado à conta {status.account ?? ''}{status.enabled ? '' : ' (pagamentos ainda desativados)'}.</> : status.reason}
          </p>
        )}
      </Panel>

      <ol className="flex flex-col gap-5">
        <Step n={1} title="Pegue as credenciais no Mercado Pago">
          Entre em <strong>mercadopago.com.br/developers</strong> → Suas integrações → crie uma aplicação (Checkout Pro) → Credenciais.
          Use primeiro as <strong>credenciais de teste</strong> (começam com <code>TEST-</code>) e, depois de testar, troque pelas de <strong>produção</strong> (<code>APP_USR-</code>).
        </Step>
        <Step n={2} title="Cole aqui e salve">
          <form onSubmit={submit} className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm font-medium text-ink">Public Key
              <input value={pk} onChange={(e) => setPublicKey(e.target.value)} disabled={!canEdit} autoComplete="off" spellCheck={false} placeholder="APP_USR-… ou TEST-…" className={inputClass} />
            </label>
            <label className="text-sm font-medium text-ink">Access Token (secreto)
              <input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} disabled={!canEdit} autoComplete="new-password" spellCheck={false}
                placeholder={g?.tokenSet ? `•••• ${g.tokenLast4} — deixe em branco para manter` : 'APP_USR-… ou TEST-…'} className={inputClass} />
            </label>
            <label className="text-sm font-medium text-ink md:col-span-2">Assinatura secreta dos avisos (opcional, recomendado)
              <input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} disabled={!canEdit} autoComplete="new-password" spellCheck={false}
                placeholder={g?.webhookSecretSet ? '•••• cadastrada — deixe em branco para manter' : 'aparece no Mercado Pago em Webhooks → Assinatura secreta'} className={inputClass} />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink md:col-span-2">
              <input type="checkbox" className="size-5" checked={on} onChange={(e) => setEnabled(e.target.checked)} disabled={!canEdit} />
              Ativar pagamento online (as empresas passam a ver o botão “Pagar com Mercado Pago”)
            </label>
            {canEdit && <button type="submit" disabled={save.isPending} className={`${primaryButton} w-fit`}>{save.isPending ? 'Salvando…' : 'Salvar credenciais'}</button>}
          </form>
          <p className="mt-2 text-xs">O Access Token fica guardado no banco numa área que nem o site nem as empresas conseguem ler; depois de salvo, só aparecem os 4 últimos dígitos.</p>
        </Step>
        <Step n={3} title="Gere a chave de integração e cadastre no Cloudflare">
          É ela que permite ao servidor da Tucaí usar o token com segurança. Gere, copie e cadastre como <strong>segredo</strong> no Cloudflare:
          Workers &amp; Pages → plataforma-sucess → Settings → Variables and Secrets → Add → tipo <strong>Secret</strong>, nome <code>PAYMENTS_INTEGRATION_KEY</code>.
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" disabled={genKey.isPending} onClick={() => { if (!g?.integrationKeySet || window.confirm('Gerar uma nova chave? A atual deixa de funcionar até você atualizar o segredo no Cloudflare.')) genKey.mutate() }} className={secondaryButton}>
                <KeyRound aria-hidden="true" className="size-4" />{g?.integrationKeySet ? 'Gerar nova chave' : 'Gerar chave'}
              </button>
            </div>
          )}
          {newKey && (
            <div role="alert" className="mt-2 flex flex-col gap-2 rounded-xl bg-muted p-3">
              <p className="text-ink">Copie agora: a chave aparece <strong>só desta vez</strong>.</p>
              <code className="break-all text-xs text-ink">{newKey}</code>
              <button type="button" onClick={() => copy(newKey, () => toast.success('Chave copiada.'))} className={`${secondaryButton} w-fit`}><Copy aria-hidden="true" className="size-4" />Copiar chave</button>
            </div>
          )}
        </Step>
        <Step n={4} title="Cadastre o endereço dos avisos no Mercado Pago">
          Na sua aplicação do Mercado Pago → <strong>Webhooks</strong> → URL de produção (e de teste): cole o endereço abaixo e marque o evento <strong>Pagamentos</strong>.
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded-lg bg-muted px-2 py-1 text-xs text-ink">{webhookUrl}</code>
            <button type="button" onClick={() => copy(webhookUrl, () => toast.success('Endereço copiado.'))} className={secondaryButton}><Copy aria-hidden="true" className="size-4" />Copiar</button>
          </div>
          <p className="mt-1 text-xs">Quando o pagamento é aprovado, a cobrança é marcada como paga e o plano renova sozinho por mais um mês.</p>
        </Step>
        <Step n={5} title="Teste">
          Clique em <strong>Testar conexão</strong>. Depois, no Financeiro, gere uma mensalidade, use <strong>Link de pagamento</strong> e pague com um usuário de teste do Mercado Pago.
          Com tudo certo, troque para as credenciais de produção.
        </Step>
      </ol>
    </div>
  )
}
