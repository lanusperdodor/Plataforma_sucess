import { useQuery } from '@tanstack/react-query'
import { Bike, Building2, Map as MapIcon, Megaphone, ClipboardList, Gavel, Lock, LayoutDashboard, MapPinned, ShieldCheck, Users, type LucideIcon, CreditCard, KeyRound, ReceiptText, Settings, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { StateShell } from '../../components/feedback/StateShell.tsx'
import { AccountMenu } from '../../components/account/AccountMenu.tsx'
import { ThemeToggleButton } from '../../components/account/ThemeToggle.tsx'
import { BRAND } from '../../config/brand.ts'
import { canAdmin, getMyAccess, type AdminAccess, type PlatformPermissionCode } from '../../features/admin/repository.ts'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { AdminAudit } from './AdminAudit.tsx'
import { AdminBusinesses } from './AdminBusinesses.tsx'
import { AdminCities } from './AdminCities.tsx'
import { AdminCouriers } from './AdminCouriers.tsx'
import { AdminModeration } from './AdminModeration.tsx'
import { AdminPrivacy } from './AdminPrivacy.tsx'
import { AdminDashboard } from './AdminDashboard.tsx'
import { AdminSecurity } from './AdminSecurity.tsx'
import { AdminSettings } from './AdminSettings.tsx'
import { AdminFinance } from './AdminFinance.tsx'
import { AdminPayments } from './AdminPayments.tsx'
import { AdminLogins } from './AdminLogins.tsx'
import { AdminOrders } from './AdminOrders.tsx'
import { AdminTeam } from './AdminTeam.tsx'
import { AdminAccessContext } from './access-context.ts'
import { AdminAds } from './AdminAds.tsx'
import { AdminRegions } from './AdminRegions.tsx'

export const ADMIN_ACCESS_KEY = ['admin', 'access'] as const

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  tone: Tone
  /** Permissão exigida; `master` = reservado ao Master; ausente = qualquer integrante. */
  permission?: PlatformPermissionCode | 'master'
}

type Tone = 'blue' | 'orange' | 'green' | 'violet' | 'teal' | 'amber' | 'rose'
/** Classes completas (o Tailwind precisa encontrá-las no código). */
const CHIP: Record<Tone, string> = {
  blue: 'bg-tone-blue/15 text-tone-blue', orange: 'bg-tone-orange/15 text-tone-orange', green: 'bg-tone-green/15 text-tone-green',
  violet: 'bg-tone-violet/15 text-tone-violet', teal: 'bg-tone-teal/15 text-tone-teal', amber: 'bg-tone-amber/15 text-tone-amber', rose: 'bg-tone-rose/15 text-tone-rose',
}

const NAV: NavItem[] = [
  { to: '/admin', label: 'Painel', icon: LayoutDashboard, tone: 'blue', permission: 'admin.dashboard' },
  { to: '/admin/pedidos', label: 'Pedidos', icon: ReceiptText, tone: 'orange', permission: 'orders.view' },
  { to: '/admin/estabelecimentos', label: 'Estabelecimentos', icon: Building2, tone: 'violet', permission: 'businesses.review' },
  { to: '/admin/entregadores', label: 'Entregadores', icon: Bike, tone: 'orange', permission: 'couriers.review' },
  { to: '/admin/cidades', label: 'Cidades', icon: MapPinned, tone: 'teal', permission: 'cities.manage' },
  { to: '/admin/regioes', label: 'Regiões', icon: MapIcon, tone: 'teal', permission: 'master' },
  { to: '/admin/anuncios', label: 'Anúncios', icon: Megaphone, tone: 'rose', permission: 'master' },
  { to: '/admin/financeiro', label: 'Financeiro', icon: Wallet, tone: 'green', permission: 'finance.view' },
  { to: '/admin/pagamentos', label: 'Pagamentos', icon: CreditCard, tone: 'green', permission: 'finance.view' },
  { to: '/admin/logins', label: 'Logins', icon: KeyRound, tone: 'blue', permission: 'users.view' },
  { to: '/admin/equipe', label: 'Equipe', icon: Users, tone: 'amber', permission: 'master' },
  { to: '/admin/auditoria', label: 'Auditoria', icon: ClipboardList, tone: 'violet', permission: 'audit.view' },
  { to: '/admin/privacidade', label: 'Privacidade', icon: Lock, tone: 'blue', permission: 'privacy.manage' },
  { to: '/admin/moderacao', label: 'Moderação', icon: Gavel, tone: 'rose', permission: 'moderation.manage' },
  { to: '/admin/configuracoes', label: 'Configurações', icon: Settings, tone: 'amber', permission: 'master' },
  { to: '/admin/seguranca', label: 'Segurança', icon: ShieldCheck, tone: 'teal' },
]

function allowed(access: AdminAccess, item: NavItem): boolean {
  if (!item.permission) return true
  if (item.permission === 'master') return access.isMaster && access.mfaOk
  return canAdmin(access, item.permission)
}

function Guard({ access, item, children }: { access: AdminAccess; item: NavItem; children: ReactNode }) {
  if (!access.mfaOk) return <Navigate to="/admin/seguranca" replace />
  if (!allowed(access, item)) {
    return (
      <StateShell
        icon={ShieldCheck}
        title="Sem permissão para esta área"
        description="Peça ao Master da Tucaí para liberar esta permissão no seu perfil administrativo."
      />
    )
  }
  return <>{children}</>
}

function Layout({ access, children }: { access: AdminAccess; children: ReactNode }) {
  const items = NAV.filter((i) => allowed(access, i) || !i.permission)
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-[var(--z-nav)] border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Link to="/admin" className="inline-flex min-h-11 items-center gap-2" aria-label="Painel Master — início">
            <img src={BRAND.assets.icon} alt="" width={28} height={28} className="size-7 rounded-lg" />
            <span className="text-sm font-bold text-ink">Painel Master</span>
          </Link>
          <span className="hidden rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-ink-muted sm:inline">
            {access.isMaster ? 'Master' : 'Operador'}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggleButton />
            <AccountMenu context="admin" />
          </div>
        </div>
        <nav aria-label="Seções do painel" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 pb-2 md:hidden">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.to === '/admin'}
              className={({ isActive }) =>
                `pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm ${isActive ? 'bg-surface font-semibold text-ink ring-2 ring-tone-blue/40' : 'text-ink-muted'}`
              }
            >
              <span aria-hidden="true" className={`grid size-6 place-items-center rounded-md ${CHIP[i.tone]}`}><i.icon className="size-3.5" /></span>
              {i.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-4 py-6">
        <nav aria-label="Menu do painel" className="hidden w-52 shrink-0 md:block">
          <ul className="sticky top-20 flex flex-col gap-1">
            {items.map((i) => (
              <li key={i.to}>
                <NavLink
                  to={i.to}
                  end={i.to === '/admin'}
                  className={({ isActive }) =>
                    `pressable flex min-h-11 items-center gap-3 rounded-xl px-2 text-sm ${isActive ? 'bg-surface font-bold text-ink shadow-[var(--shadow-card)] ring-1 ring-line' : 'font-medium text-ink-muted hover:bg-surface/60'}`
                  }
                >
                  <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-lg ${CHIP[i.tone]}`}><i.icon className="size-4" /></span>
                  {i.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="conteudo" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  )
}

/** Painel Master. A interface só organiza; cada ação é autorizada de novo no banco. */
export function AdminApp() {
  const { session, loading } = useAuth()
  const access = useQuery({
    queryKey: [...ADMIN_ACCESS_KEY, session?.user.id ?? ''],
    queryFn: getMyAccess,
    enabled: !!session,
    staleTime: 30_000,
  })

  if (loading || (session && access.isLoading)) {
    return <p role="status" className="p-6 text-sm text-ink-muted">Verificando acesso…</p>
  }
  if (!session) return <Navigate to="/entrar" replace state={{ from: '/admin' }} />
  if (access.isError) {
    return (
      <div className="p-6">
        <ErrorState error={access.error} onRetry={() => void access.refetch()} />
      </div>
    )
  }
  const data = access.data
  if (!data || (!data.isMaster && !data.isOperator)) {
    return (
      <div className="p-6">
        <StateShell
          icon={ShieldCheck}
          role="alert"
          title="Acesso restrito"
          description="Esta conta não faz parte da equipe administrativa da Tucaí."
          action={<Link to="/" className="pressable inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-semibold text-surface">Voltar ao início</Link>}
        />
      </div>
    )
  }

  const item = (to: string) => NAV.find((n) => n.to === to)!
  return (
    <AdminAccessContext.Provider value={data}>
      <Layout access={data}>
        <Routes>
          <Route index element={<Guard access={data} item={item('/admin')}><AdminDashboard /></Guard>} />
          <Route path="estabelecimentos" element={<Guard access={data} item={item('/admin/estabelecimentos')}><AdminBusinesses /></Guard>} />
          <Route path="entregadores" element={<Guard access={data} item={item('/admin/entregadores')}><AdminCouriers /></Guard>} />
          <Route path="cidades" element={<Guard access={data} item={item('/admin/cidades')}><AdminCities /></Guard>} />
          <Route path="equipe" element={<Guard access={data} item={item('/admin/equipe')}><AdminTeam /></Guard>} />
          <Route path="auditoria" element={<Guard access={data} item={item('/admin/auditoria')}><AdminAudit /></Guard>} />
          <Route path="privacidade" element={<Guard access={data} item={item('/admin/privacidade')}><AdminPrivacy /></Guard>} />
          <Route path="moderacao" element={<Guard access={data} item={item('/admin/moderacao')}><AdminModeration /></Guard>} />
          <Route path="regioes" element={<Guard access={data} item={item('/admin/regioes')}><AdminRegions /></Guard>} />
          <Route path="anuncios" element={<Guard access={data} item={item('/admin/anuncios')}><AdminAds /></Guard>} />
          <Route path="financeiro" element={<Guard access={data} item={item('/admin/financeiro')}><AdminFinance /></Guard>} />
          <Route path="pedidos" element={<Guard access={data} item={item('/admin/pedidos')}><AdminOrders /></Guard>} />
          <Route path="logins" element={<Guard access={data} item={item('/admin/logins')}><AdminLogins /></Guard>} />
          <Route path="pagamentos" element={<Guard access={data} item={item('/admin/pagamentos')}><AdminPayments /></Guard>} />
          <Route path="configuracoes" element={<Guard access={data} item={item('/admin/configuracoes')}><AdminSettings /></Guard>} />
          <Route path="seguranca" element={<AdminSecurity />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Layout>
    </AdminAccessContext.Provider>
  )
}
