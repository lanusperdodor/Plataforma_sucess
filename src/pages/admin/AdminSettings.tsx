import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Settings, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/feedback/toast-context.ts'
import { getMyName, setMyName } from '../../features/admin/repository.ts'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { MaintenanceSection } from './AdminMaintenance.tsx'
import { AdminHeader, errorMessage, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

function MyNameSection() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const userId = session?.user.id ?? ''
  const q = useQuery({ queryKey: ['admin', 'my-name', userId], queryFn: () => getMyName(userId), enabled: !!userId })
  const [name, setName] = useState<string | null>(null)
  const value = name ?? q.data ?? ''
  const save = useMutation({
    mutationFn: () => setMyName(userId, value),
    onSuccess: () => {
      toast.success('Nome atualizado.')
      setName(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'my-name'] })
      void qc.invalidateQueries({ queryKey: ['me', 'identity'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'staff'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Panel className="flex flex-col gap-2 text-sm">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim().length >= 2) save.mutate()
        }}
      >
        <div className="min-w-56 flex-1">
          <label htmlFor="my-name" className="mb-1 block text-sm font-medium text-ink">Seu nome no painel</label>
          <input id="my-name" maxLength={120} value={value} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <button type="submit" disabled={save.isPending || value.trim().length < 2} className={primaryButton}>Salvar nome</button>
      </form>
      <p className="text-xs text-ink-muted">Aparece no topo do painel e na lista da equipe. O login continua sendo o seu usuário (admin) ou e-mail.</p>
    </Panel>
  )
}

/** Configurações do Master. */
export function AdminSettings() {
  return (
    <div className="flex flex-col gap-6">
      <AdminHeader title="Configurações" subtitle="Ferramentas do Master para operar e testar a plataforma." />
      <MaintenanceSection />
      <MyNameSection />
      <Panel className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-ink"><ShieldCheck aria-hidden="true" className="size-5" />Verificação em duas etapas e exigência de MFA da equipe</span>
        <Link to="/admin/seguranca" className={secondaryButton}><Settings aria-hidden="true" className="size-4" />Abrir Segurança</Link>
      </Panel>
      <Panel className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-ink"><KeyRound aria-hidden="true" className="size-5" />Dados de teste e contas de acesso agora ficam na aba Logins</span>
        <Link to="/admin/logins" className={secondaryButton}>Abrir Logins</Link>
      </Panel>
    </div>
  )
}
