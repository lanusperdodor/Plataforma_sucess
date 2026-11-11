import { Bell } from 'lucide-react'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { LoginInvite } from '../components/feedback/LoginInvite.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'

export function NotificationsPage() {
  const { session } = useAuth()
  return (
    <Page>
      <PageHeader icon={Bell} title="Notificações" subtitle="Pedidos, novidades e vagas." />
      {!session ? (
        <LoginInvite icon={Bell} title="Receba avisos dos seus pedidos" description="Entre para ser avisado a cada etapa." />
      ) : (
        <EmptyState icon={Bell} title="Nenhuma notificação" description="As notificações serão ativadas junto com os pedidos online." />
      )}
    </Page>
  )
}
