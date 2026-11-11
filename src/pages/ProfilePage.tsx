import { ArrowLeft, Bell, Briefcase, ShieldCheck, Bookmark, ChevronRight, LogOut, Receipt, Store, User, type LucideIcon } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { LoginInvite } from '../components/feedback/LoginInvite.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'

interface Item {
  slug: string
  to: string
  label: string
  text: string
  icon: LucideIcon
}

const ITEMS: Item[] = [
  { slug: 'dados', to: '/conta', label: 'Dados da conta', text: 'Nome, telefone e e-mail', icon: User },
  { slug: 'pedidos', to: '/pedidos', label: 'Pedidos', text: 'Em andamento e anteriores', icon: Receipt },
  { slug: 'candidaturas', to: '/vagas/minhas-candidaturas', label: 'Candidaturas', text: 'Vagas em que você se inscreveu', icon: Briefcase },
  { slug: 'conectuai', to: '/conectuai', label: 'Conectuaí', text: 'Seu perfil social, amigos, recados e comunidades', icon: Bookmark },
  { slug: 'notificacoes', to: '/notificacoes', label: 'Notificações', text: 'Avisos de pedidos e novidades', icon: Bell },
  { slug: 'privacidade', to: '/perfil/privacidade', label: 'Privacidade e dados', text: 'Baixar dados, solicitações LGPD e sessões', icon: ShieldCheck },
]

/** Perfil: menu da conta. Subseções levam às páginas reais. */
export function ProfilePage() {
  const { session, authz, signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const section = ITEMS.find((i) => pathname === `/perfil/${i.slug}`)

  if (section) {
    const Icon = section.icon
    return (
      <Page>
        <Link to="/perfil" className="pressable inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-ink"><ArrowLeft aria-hidden="true" className="size-4" />Perfil</Link>
        <PageHeader icon={Icon} title={section.label} subtitle={section.text} />
        {!session ? (
          <LoginInvite icon={Icon} title="Entre para ver esta seção" description="Ela guarda informações da sua conta." />
        ) : (
          <Navigate to={section.to} replace />
        )}
      </Page>
    )
  }

  const email = session?.user.email
  const isAdmin = !!authz?.roles.some((r) => r === 'platform_master' || r === 'platform_operator')
  return (
    <Page>
      <PageHeader icon={User} title="Perfil" subtitle="Sua conta, endereços, favoritos e preferências." />
      {session ? (
        <section className="flex items-center gap-3 rounded-card bg-brand p-4 text-surface">
          <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-orange text-lg font-bold text-ink">{(email ?? '?').slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{email}</p>
            <p className="text-xs opacity-80">{authz?.roles.includes('customer') ? 'Cliente Tucaí' : 'Conta Tucaí'}</p>
          </div>
        </section>
      ) : (
        <LoginInvite icon={User} title="Entre na sua conta" description="Peça, salve favoritos, siga comércios e acompanhe entregas." />
      )}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {[
          ...((authz?.memberships.length ?? 0) > 0 ? [{ slug: 'painel', to: '/painel', label: 'Painel do estabelecimento', text: 'Loja, horários e cardápio', icon: Store }] : []),
          { slug: 'negocio', to: '/cadastrar-negocio', label: 'Meus negócios', text: 'Cadastre ou acompanhe seu estabelecimento', icon: Briefcase },
          ...(isAdmin ? [{ slug: 'admin', to: '/admin', label: 'Administração', text: 'Painel Master da Tucaí', icon: ShieldCheck }] : []),
          ...ITEMS,
        ].map(({ slug, to, label, text, icon: Icon }) => (
          <li key={slug}>
            <Link to={to} className="hover-lift pressable flex min-h-16 items-center gap-3 rounded-card border border-line bg-surface p-3">
              <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-ink"><Icon className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">{label}</span>
                <span className="block truncate text-xs text-ink-muted">{text}</span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
      {session && (
        <button type="button" onClick={() => void signOut().then(() => navigate('/'))} className="pressable inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-line px-5 text-sm font-semibold text-danger">
          <LogOut aria-hidden="true" className="size-4" />Sair da conta
        </button>
      )}
    </Page>
  )
}