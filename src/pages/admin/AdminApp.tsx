import { useQuery } from '@tanstack/react-query'
import { Bike, Building2, Map as MapIcon, Megaphone, ClipboardList, Gavel, Lock, LayoutDashboard, MapPinned, ShieldCheck, Users, type LucideIcon, CreditCard, KeyRound, ReceiptText, Settings, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { PanelDrawer, PanelMenuButton, PanelSidebar, usePanelDrawer, type PanelNavGroup } from '../../components/panel/PanelNav.tsx'
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
  group: GroupId
  /** Permissão exigida; `master` = reservado ao Master; ausente = qualquer integrante. */
  permission?: PlatformPermissionCode | 'master'
}

type GroupId = 'visao' | 'operacao' | 'estabelecimentos' | 'financeiro' | 'cidades' | 'usuarios' | 'comunidade' | 'seguranca' | 'config'
/** Grupos do menu do Master, só com os módulos que existem. */
const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'visao', label: 'Visão geral' },
  { id: 'operacao', label: 'Pedidos e operação' },
  { id: 'estabelecimentos', label: 'Estabelecimentos' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'cidades', label: 'Cidades e regiões' },
  { id: 'usuarios', label: 'Usuários e permissões' },
  { id: 'comunidade', label: 'Tucaí Conecta' },
  { id: 'seguranca', label: 'Segurança e auditoria' },
  { id: 'config', label: 'Configurações' },
]

const NAV: NavItem[] = [
  { to: '/admin', label: 'Painel', icon: LayoutDashboard, group: 'visao', permission: 'admin.dashboard' },
  { to: '/admin/pedidos', label: 'Pedidos', icon: ReceiptText, group: 'operacao', permission: 'orders.view' },
  { to: '/admin/estabelecimentos', label: 'Estabelecimentos', icon: Building2, group: 'estabelecimentos', permission: 'businesses.review' },
  { to: '/admin/entregadores', label: 'Entregadores', icon: Bike, group: 'operacao', permission: 'couriers.review' },
  { to: '/admin/cidades', label: 'Cidades', icon: MapPinned, group: 'cidades', permission: 'cities.manage' },
  { to: '/admin/regioes', label: 'Regiões', icon: MapIcon, group: 'cidades', permission: 'master' },
  { to: '/admin/anuncios', label: 'Anúncios', icon: Megaphone, group: 'estabelecimentos', permission: 'master' },
  { to: '/admin/financeiro', label: 'Financeiro', icon: Wallet, group: 'financeiro', permission: 'finance.view' },
  { to: '/admin/pagamentos', label: 'Pagamentos', icon: CreditCard, group: 'financeiro', permission: 'finance.view' },
  { to: '/admin/logins', label: 'Logins', icon: KeyRound, group: 'usuarios', permission: 'users.view' },
  { to: '/admin/equipe', label: 'Equipe', icon: Users, group: 'usuarios', permission: 'master' },
  { to: '/admin/auditoria', label: 'Auditoria', icon: ClipboardList, group: 'seguranca', permission: 'audit.view' },
  { to: '/admin/privacidade', label: 'Privacidade', icon: Lock, group: 'seguranca', permission: 'privacy.manage' },
  { to: '/admin/moderacao', label: 'Moderação', icon: Gavel, group: 'comunidade', permission: 'moderation.manage' },
  { to: '/admin/configuracoes', label: 'Configurações', icon: Settings, group: 'config', permission: 'master' },
  { to: '/admin/seguranca', label: 'Segurança', icon: ShieldCheck, group: 'seguranca' },
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
  const groups: PanelNavGroup[] = GROUPS.map((g) => ({
    id: g.id, label: g.label,
    items: items.filter((i) => i.group === g.id).map((i) => ({ to: i.to, label: i.label, icon: i.icon, end: i.to === '/admin' })),
  }))
  const drawer = usePanelDrawer()
  const brand = (
    <>
      <img src={BRAND.assets.icon} alt="" width={28} height={28} className="size-7 rounded-lg" />
      <span>Painel Master</span>
    </>
  )
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-[var(--z-nav)] border-b border-line bg-surface">
        <div className="flex h-14 items-center gap-2 px-2 sm:px-4">
          <PanelMenuButton open={drawer.open} onClick={() => drawer.setOpen(true)} />
          <Link to="/admin" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-ink" aria-label="Painel Master — início">{brand}</Link>
          <span className="hidden rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-ink-muted sm:inline">
            {access.isMaster ? 'Master' : 'Operador'}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggleButton />
            <AccountMenu context="admin" />
          </div>
        </div>
      </header>
      <PanelDrawer open={drawer.open} onClose={drawer.close} groups={groups} scope="admin" label="Menu do painel" title={brand} />
      <div className="flex flex-1">
        <PanelSidebar groups={groups} scope="admin" label="Menu do painel" />
        <main id="conteudo" className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
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
          <Route path="financeiro/*" element={<Guard access={data} item={item('/admin/financeiro')}><AdminFinance /></Guard>} />
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
