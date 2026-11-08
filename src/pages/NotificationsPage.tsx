import { Bell } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { LoginInvite } from '../components/feedback/LoginInvite.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { DEMO_NOTIFICATIONS } from '../features/demo/preview-data.ts'

export function NotificationsPage() {
  const { session } = useAuth()
  return (
    <Page>
      <PageHeader icon={Bell} title="Notificações" subtitle="Pedidos, novidades e vagas." />
      {!session ? (
        <LoginInvite icon={Bell} title="Receba avisos dos seus pedidos" description="Entre para ser avisado a cada etapa." />
      ) : (
        <EmptyState icon={Bell} title="Nenhuma notificação" description="Quando algo acontecer, você vê aqui." />
      )}
      <section aria-labelledby="not-ex" className="flex flex-col gap-2">
        <h2 id="not-ex" className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Exemplos</h2>
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {DEMO_NOTIFICATIONS.map((n) => (
            <li key={n.id}>
              <Link to={n.to} className="pressable flex min-h-16 items-start gap-3 p-4">
                <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${n.unread ? 'bg-orange' : 'bg-line'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">
                    {n.title}
                    {n.unread && <span className="sr-only"> (não lida)</span>}
                  </span>
                  <span className="block truncate text-xs text-ink-muted">{n.text}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-muted">{n.whenLabel}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  )
}