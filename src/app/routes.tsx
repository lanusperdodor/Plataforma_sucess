import type { ReactNode } from 'react'
import { Outlet, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell.tsx'
import { RequireAuth } from '../features/auth/RequireAuth.tsx'
import { AuthShell } from './AuthShell.tsx'
import { lazyNamed, pageLoaders } from './lazy.ts'
import { RouteBoundary } from './RouteBoundary.tsx'

const HomePage = lazyNamed(pageLoaders['/'], 'HomePage')
const ExplorePage = lazyNamed(pageLoaders['/explorar'], 'ExplorePage')
const RestaurantsPage = lazyNamed(pageLoaders['/restaurantes'], 'RestaurantsPage')
const RestaurantPage = lazyNamed(pageLoaders['/restaurantes/:slug'], 'RestaurantPage')
const StoresPage = lazyNamed(pageLoaders['/lojas'], 'StoresPage')
const StorePage = lazyNamed(pageLoaders['/lojas/:slug'], 'StorePage')
const ServicesPage = lazyNamed(pageLoaders['/servicos'], 'ServicesPage')
const JobsPage = lazyNamed(pageLoaders['/vagas'], 'JobsPage')
const JobPage = lazyNamed(pageLoaders['/vagas/:id'], 'JobPage')
const CommunityPage = lazyNamed(pageLoaders['/comunidade'], 'CommunityPage')
const PostPage = lazyNamed(pageLoaders['/comunidade/:postId'], 'PostPage')
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
const AdminLoginPage = lazyNamed(() => import('../pages/AdminLoginPage.tsx'), 'AdminLoginPage')
const AccountPage = lazyNamed(() => import('../pages/AccountPage.tsx'), 'AccountPage')
const VisualPreview = lazyNamed(() => import('../features/preview/VisualPreview.tsx'), 'VisualPreview')

const PROFILE_SECTIONS = ['dados', 'enderecos', 'pagamentos', 'favoritos', 'seguidas', 'salvos', 'cupons', 'configuracoes']

function ShellLayout() {
  return (
    <AppShell>
      <RouteBoundary>
        <Outlet />
      </RouteBoundary>
    </AppShell>
  )
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
      <Route path="/admin/entrar" element={<Auth><AdminLoginPage /></Auth>} />
      <Route path="/cadastro" element={<Auth><SignUpPage /></Auth>} />
      <Route path="/recuperar-senha" element={<Auth><ResetPasswordPage /></Auth>} />
      <Route path="/nova-senha" element={<Auth><NewPasswordPage /></Auth>} />
      <Route path="/conta" element={<Auth><RequireAuth><AccountPage /></RequireAuth></Auth>} />
      <Route
        path="/previa/*"
        element={<RouteBoundary><VisualPreview /></RouteBoundary>}
      />
      <Route element={<ShellLayout />}>
        <Route index element={<HomePage />} />
        <Route path="explorar" element={<ExplorePage />} />
        <Route path="restaurantes" element={<RestaurantsPage />} />
        <Route path="restaurantes/:slug" element={<RestaurantPage />} />
        <Route path="lojas" element={<StoresPage />} />
        <Route path="lojas/:slug" element={<StorePage />} />
        <Route path="servicos" element={<ServicesPage />} />
        <Route path="vagas" element={<JobsPage />} />
        <Route path="vagas/:id" element={<JobPage />} />
        <Route path="comunidade" element={<CommunityPage />} />
        <Route path="comunidade/:postId" element={<PostPage />} />
        <Route path="busca" element={<SearchPage />} />
        <Route path="sacola" element={<CartPage />} />
        {/* Pedidos, Perfil e Notificações abrem para visitantes com convite de login;
            dados pessoais reais continuam protegidos por RLS. Checkout exige sessão. */}
        <Route path="pedidos" element={<OrdersPage />} />
        <Route path="perfil">
          <Route index element={<ProfilePage />} />
          {PROFILE_SECTIONS.map((section) => (
            <Route key={section} path={section} element={<ProfilePage />} />
          ))}
        </Route>
        <Route path="notificacoes" element={<NotificationsPage />} />
        <Route element={<PrivateLayout />}>
          <Route path="sacola/checkout" element={<CheckoutPage />} />
          <Route path="pedidos/:id" element={<OrderPage />} />

        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
