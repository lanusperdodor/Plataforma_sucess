import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/feedback/toast-context.ts'
import { PLATFORM_STATUS_KEY } from '../../components/platform/MaintenanceGate.tsx'
import { getMaintenanceStatus, setMaintenance, type PlatformMode } from '../../features/platform/repository.ts'
import { dangerButton, errorMessage, formatDateTime, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

const MODE_LABEL: Record<PlatformMode, string> = { normal: 'NORMAL', preparando: 'PREPARANDO MANUTENÇÃO', manutencao: 'EM MANUTENÇÃO' }
const INFLIGHT: Record<string, string> = {
  pedidos_abertos: 'Pedidos em andamento', pedidos_aguardando_aceite: 'Aguardando aceite da loja', entregas_em_rota: 'Entregas com entregador',
  comandas_abertas: 'Comandas abertas', caixas_abertos: 'Caixas abertos', cobrancas_em_aberto: 'Cobranças em aberto',
  campanhas_aguardando_pagamento: 'Campanhas aguardando pagamento',
}
const INTEGRITY: Record<string, string> = {
  pedido_em_rota_sem_coleta: 'Pedido em rota sem coleta registrada', entrega_coletada_pedido_inconsistente: 'Entrega coletada com pedido inconsistente',
  comanda_fechada_pagamento_diferente: 'Comanda fechada com pagamento diferente do total', caixa_aberto_mais_de_24h: 'Caixa aberto há mais de 24 h',
  campanha_ativa_vencida: 'Campanha ativa já vencida',
}

/** Datetime-local (horário de Brasília do navegador) → ISO. */
const toIso = (v: string) => (v ? new Date(v).toISOString() : null)

/** Modo manutenção global: NORMAL → PREPARANDO → EM MANUTENÇÃO → NORMAL. Exige MFA (verificado no banco). */
export function MaintenanceSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['admin', 'maintenance'], queryFn: getMaintenanceStatus, refetchInterval: 15_000 })
  const [target, setTarget] = useState<PlatformMode | null>(null)
  const [reason, setReason] = useState('')
  const [eta, setEta] = useState('')
  const [confirm, setConfirm] = useState('')
  const [report, setReport] = useState<Record<string, number> | null>(null)
  const change = useMutation({
    mutationFn: () => setMaintenance(target!, reason, toIso(eta), confirm),
    onSuccess: (r) => {
      toast.success(`Plataforma: ${MODE_LABEL[r.mode as PlatformMode] ?? r.mode}.`)
      if (r.mode === 'normal') setReport(r.integridade)
      setTarget(null); setConfirm('')
      void qc.invalidateQueries({ queryKey: ['admin', 'maintenance'] })
      void qc.invalidateQueries({ queryKey: PLATFORM_STATUS_KEY })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const s = q.data
  if (q.isError) return <Panel><p role="alert" className="text-sm text-danger">{errorMessage(q.error)}</p></Panel>
  if (!s) return <Panel><p role="status" className="text-sm text-ink-muted">Carregando estado da plataforma…</p></Panel>
  const word = target === 'normal' ? 'NORMAL' : 'MANUTENCAO'
  const problems = Object.entries(report ?? s.integridade).filter(([, v]) => v > 0)
  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><Wrench aria-hidden="true" className="size-5" />Modo manutenção</h2>
          <p className="text-sm text-ink-muted">Bloqueia novas operações no banco para todos os usuários comuns. O Master continua com acesso.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${s.mode === 'normal' ? 'bg-muted text-ink' : 'bg-ink text-surface'}`}>{MODE_LABEL[s.mode]}</span>
      </div>
      {s.mode !== 'normal' && (
        <p className="text-sm text-ink">
          Motivo: <strong>{s.reason}</strong>{s.eta ? <> · previsão {formatDateTime(s.eta)}</> : null} · alterado por {s.changed_by ?? '—'} em {formatDateTime(s.changed_at)}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Object.entries(s.em_andamento).map(([k, v]) => (
          <div key={k} className="rounded-xl bg-muted p-3"><dt className="text-xs text-ink-muted">{INFLIGHT[k] ?? k}</dt><dd className="text-lg font-bold tabular-nums text-ink">{v}</dd></div>
        ))}
      </dl>
      {!s.mfa && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm text-ink">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Para mudar o estado da plataforma, confirme a verificação em duas etapas nesta sessão em <Link to="/admin/seguranca" className="font-semibold underline">Segurança</Link>.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {s.mode === 'normal' && <button type="button" onClick={() => setTarget('preparando')} className={dangerButton}>ATIVAR MANUTENÇÃO</button>}
        {s.mode === 'preparando' && <>
          <button type="button" onClick={() => setTarget('manutencao')} className={dangerButton}>Iniciar bloqueio total</button>
          <button type="button" onClick={() => setTarget('normal')} className={secondaryButton}>Cancelar e voltar ao normal</button>
        </>}
        {s.mode === 'manutencao' && <button type="button" onClick={() => setTarget('normal')} className={primaryButton}>Desativar manutenção</button>}
      </div>
      {target && (
        <form onSubmit={(e) => { e.preventDefault(); change.mutate() }} className="flex flex-col gap-3 rounded-xl border border-line p-4" aria-label="Confirmar mudança de estado">
          <p className="text-sm text-ink">
            {target === 'preparando' && 'Fase de preparação: novos pedidos, pagamentos, comandas e alterações ficam bloqueados; pedidos, entregas e comandas já abertos podem terminar. Acompanhe os números acima antes do bloqueio total.'}
            {target === 'manutencao' && 'Bloqueio total: a página de manutenção aparece para todos os usuários comuns. Entregadores ainda concluem corridas em rota e a equipe pode fechar comandas/caixas abertos.'}
            {target === 'normal' && 'A plataforma volta a funcionar normalmente e as verificações de integridade são executadas.'}
          </p>
          {target !== 'normal' && (
            <>
              <label className="text-sm font-medium text-ink">Motivo (registrado na auditoria)
                <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={300} className={`${inputClass} mt-1`} />
              </label>
              <label className="text-sm font-medium text-ink">Previsão de retorno (opcional, aparece para o público)
                <input type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} className={`${inputClass} mt-1`} />
              </label>
            </>
          )}
          <label className="text-sm font-medium text-ink">Digite <strong>{word}</strong> para confirmar
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className={`${inputClass} mt-1`} />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={change.isPending || confirm.trim().toUpperCase() !== word} className={target === 'normal' ? primaryButton : dangerButton}>Confirmar</button>
            <button type="button" onClick={() => { setTarget(null); setConfirm('') }} className={secondaryButton}>Voltar</button>
          </div>
        </form>
      )}
      <div className="text-sm">
        <h3 className="mb-1 font-semibold text-ink">Verificações de integridade</h3>
        {problems.length === 0 ? (
          <p className="flex items-center gap-1.5 text-ink"><CheckCircle2 aria-hidden="true" className="size-4 text-success" />Nenhuma inconsistência encontrada.</p>
        ) : (
          <ul className="list-disc pl-5 text-ink">{problems.map(([k, v]) => <li key={k}>{INTEGRITY[k] ?? k}: <strong>{v}</strong></li>)}</ul>
        )}
        <p className="mt-2 text-xs text-ink-muted">Se o painel ficar indisponível, use supabase/admin/manutencao_recuperar.sql no SQL Editor do Supabase. Saúde do sistema: /api/health.</p>
      </div>
    </Panel>
  )
}
