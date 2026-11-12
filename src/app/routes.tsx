import type { ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell.tsx'
import { RequireAuth } from '../features/auth/RequireAuth.tsx'
import { AuthShell } from './AuthShell.tsx'
import { lazyNamed, pageLoaders } from './lazy.ts'
import { RouteBoundary } from './RouteBoundary.tsx'

const HomePage = lazyNamed(pageLoaders['/'], 'HomePage')
const ExplorePage = lazyNamed(pageLoaders['/explorar'], 'ExplorePage')
const RestaurantsPage = lazyNamed(pageLoaders['/restaurantes'], 'RestaurantsPage')
const BusinessPage = lazyNamed(pageLoaders['/restaurantes/:slug'], 'BusinessPage')
const StoresPage = lazyNamed(pageLoaders['/lojas'], 'StoresPage')
const ServicesPage = lazyNamed(pageLoaders['/servicos'], 'ServicesPage')
const JobsPage = lazyNamed(pageLoaders['/vagas'], 'JobsPage')
const CityPage = lazyNamed(() => import('../pages/CityPage.tsx'), 'CityPage')
const JobPage = lazyNamed(pageLoaders['/vagas/:id'], 'JobPage')
const MyApplicationsPage = lazyNamed(pageLoaders['/vagas/:id'], 'MyApplicationsPage')
const ConectaPage = lazyNamed(pageLoaders['/conectuai'], 'ConectaPage')
const PostPage = lazyNamed(pageLoaders['/conectuai/:postId'], 'PostPage')
const ConectaProfilePage = lazyNamed(pageLoaders['/conectuai/u/:handle'], 'ConectaProfilePage')
const CommunitiesPage = lazyNamed(pageLoaders['/conectuai/c'], 'CommunitiesPage')
const CommunityPage = lazyNamed(pageLoaders['/conectuai/c/:slug'], 'CommunityPage')
const TopicPage = lazyNamed(pageLoaders['/conectuai/c/:slug/t/:topicId'], 'TopicPage')
const FriendsPage = lazyNamed(pageLoaders['/conectuai/amigos'], 'FriendsPage')
const CouriersPage = lazyNamed(pageLoaders['/entregadores'], 'CouriersPage')
const BusinessApplicationPage = lazyNamed(pageLoaders['/cadastrar-negocio'], 'BusinessApplicationPage')
const PrivacyPolicyPage = lazyNamed(pageLoaders['/privacidade'], 'PrivacyPolicyPage')
const TermsPage = lazyNamed(pageLoaders['/privacidade'], 'TermsPage')
const StoragePolicyPage = lazyNamed(pageLoaders['/privacidade'], 'StoragePolicyPage')
const PrivacyCenterPage = lazyNamed(pageLoaders['/perfil/privacidade'], 'PrivacyCenterPage')
const SearchPage = lazyNamed(pageLoaders['/busca'], 'SearchPage')
const CartPage = lazyNamed(pageLoaders['/sacola'], 'CartPage')
const CheckoutPage = lazyNamed(pageLoaders['/sacola/checkout'], 'CheckoutPage')
const OrdersPage = lazyNamed(pageLoaders['/pedidos'], 'OrdersPage')
const OrderPage = lazyNamed(pageLoaders['/pedidos/:id'], 'OrderPage')
const ProfilePage = lazyNamed(pageLoaders['/perfil'], 'ProfilePage')
const NotificationsPage = lazyNamed(pageLoaders['/notificacoes'], 'NotificationsPage')
const NotFoundPage = lazyNamed(() => import('../pages/NotFoundPage.tsx'), 'NotFoundPage')

const LoginPage = lazyNamed(() => import('../pages/AuthPages.tsx'), 'LoginPage')
const SignUpPage = lazyNamed(() => import('../pages/AuthPages.tsx'), 'SignUpPage')
const ResetPasswordPage = lazyNamed(() => import('../pages/AuthPages.tsx'), 'ResetPasswordPage')
const NewPasswordPage = lazyNamed(() => import('../pages/AuthPages.tsx'), 'NewPasswordPage')
const AccountPage = lazyNamed(() => import('../pages/AccountPage.tsx'), 'AccountPage')
const CourierArea = lazyNamed(pageLoaders['/entregador'], 'CourierArea')
const GestaoApp = lazyNamed(() => import('../pages/gestao/GestaoApp.tsx'), 'GestaoApp')
const TableQrPage = lazyNamed(() => import('../pages/gestao/TableQrPage.tsx'), 'TableQrPage')
const AdminApp = lazyNamed(() => import('../pages/admin/AdminApp.tsx'), 'AdminApp')

const PROFILE_SECTIONS = ['dados']

function ShellLayout() {
  return (
    <AppShell>
      <RouteBoundary>
        <Outlet />
      </RouteBoundary>
    </AppShell>
  )
}

function LegacyRedirect({ from }: { from: string }) {
  const { pathname, search } = useLocation()
  return <Navigate to={`/conectuai${pathname.slice(from.length)}${search}`} replace />
}

function PrivateLayout() {
  return (
    <RequireAuth>
      <Outlet />
    </RequireAuth>
  )
}

function Auth({ children }: { children: ReactNode }) {
  return (
    <AuthShell>
      <RouteBoundary>{children}</RouteBoundary>
    </AuthShell>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/entrar" element={<Auth><LoginPage /></Auth>} />
      {/* login único: endereço antigo da administração leva ao mesmo login, que reconhece o perfil */}
      <Route path="/admin/entrar" element={<Navigate to="/entrar" replace state={{ from: '/admin' }} />} />
      <Route path="/cadastro" element={<Auth><SignUpPage /></Auth>} />
      <Route path="/recuperar-senha" element={<Auth><ResetPasswordPage /></Auth>} />
      <Route path="/nova-senha" element={<Auth><NewPasswordPage /></Auth>} />
      <Route path="/conta" element={<Auth><RequireAuth><AccountPage /></RequireAuth></Auth>} />
      <Route path="/admin/*" element={<RouteBoundary><AdminApp /></RouteBoundary>} />
      {/* Tucaí Gestão: layout próprio em tela cheia, fora do marketplace (sem barra lateral/navegação inferior) */}
      <Route path="/painel/*" element={<RouteBoundary><RequireAuth><GestaoApp /></RequireAuth></RouteBoundary>} />
      <Route element={<ShellLayout />}>
        <Route index element={<HomePage />} />
        <Route path="explorar" element={<ExplorePage />} />
        <Route path="restaurantes" element={<RestaurantsPage />} />
        <Route path="restaurantes/:slug" element={<BusinessPage />} />
        <Route path="lojas" element={<StoresPage />} />
        <Route path="lojas/:slug" element={<BusinessPage />} />
        <Route path="servicos" element={<ServicesPage />} />
        <Route path="servicos/:slug" element={<BusinessPage />} />
        <Route path="vagas" element={<JobsPage />} />
        <Route path="cidades/:slug" element={<CityPage />} />
        <Route path="cidades/:slug/:section" element={<CityPage />} />
        <Route path="vagas/:id" element={<JobPage />} />
        <Route path="vagas/minhas-candidaturas" element={<RequireAuth><MyApplicationsPage /></RequireAuth>} />
        <Route path="conectuai" element={<RequireAuth><ConectaPage /></RequireAuth>} />
        <Route path="conectuai/amigos" element={<RequireAuth><FriendsPage /></RequireAuth>} />
        <Route path="conectuai/c" element={<RequireAuth><CommunitiesPage /></RequireAuth>} />
        <Route path="conectuai/c/:slug" element={<RequireAuth><CommunityPage /></RequireAuth>} />
        <Route path="conectuai/c/:slug/t/:topicId" element={<RequireAuth><TopicPage /></RequireAuth>} />
        <Route path="conectuai/u/:handle" element={<RequireAuth><ConectaProfilePage /></RequireAuth>} />
        <Route path="conectuai/:postId" element={<RequireAuth><PostPage /></RequireAuth>} />
        {/* Nomes antigos (Comunidade, Conecta): links salvos continuam funcionando. */}
        <Route path="conecta/*" element={<LegacyRedirect from="/conecta" />} />
        <Route path="comunidade/*" element={<LegacyRedirect from="/comunidade" />} />
        <Route path="entregadores" element={<CouriersPage />} />
        <Route path="privacidade" element={<PrivacyPolicyPage />} />
        <Route path="termos" element={<TermsPage />} />
        <Route path="armazenamento" element={<StoragePolicyPage />} />
        <Route path="busca" element={<SearchPage />} />
        <Route path="sacola" element={<CartPage />} />
        {/* QR impresso na mesa: identifica a mesa e abre o cardápio público (nada administrativo) */}
        <Route path="mesa/:token" element={<TableQrPage />} />
        {/* Pedidos, Perfil e Notificações abrem para visitantes com convite de login;
            dados pessoais reais continuam protegidos por RLS. Checkout exige sessão. */}
        <Route path="pedidos" element={<OrdersPage />} />
        <Route path="perfil">
          <Route index element={<ProfilePage />} />
          <Route path="privacidade" element={<RequireAuth><PrivacyCenterPage /></RequireAuth>} />
          {PROFILE_SECTIONS.map((section) => (
            <Route key={section} path={section} element={<ProfilePage />} />
          ))}
        </Route>
        <Route path="notificacoes" element={<NotificationsPage />} />
        <Route element={<PrivateLayout />}>
          <Route path="sacola/checkout" element={<CheckoutPage />} />
          <Route path="pedidos/:id" element={<OrderPage />} />
          <Route path="cadastrar-negocio" element={<BusinessApplicationPage />} />
          <Route path="entregador/*" element={<CourierArea />} />

        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
