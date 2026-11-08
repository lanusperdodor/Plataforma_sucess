import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { BRAND } from './config/brand.ts'
import { RequireAuth } from './features/auth/RequireAuth.tsx'
import { AccountPage } from './pages/AccountPage.tsx'
import { LoginPage, ResetPasswordPage, SignUpPage } from './pages/AuthPages.tsx'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-ink/10 bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" className="font-semibold text-brand">{BRAND.name}</Link>
          <Link to="/conta" className="text-sm">Minha conta</Link>
        </div>
      </header>
      <main className="px-4 py-8">{children}</main>
    </div>
  )
}

export function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/conta" replace />} />
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/cadastro" element={<SignUpPage />} />
        <Route path="/recuperar-senha" element={<ResetPasswordPage />} />
        <Route path="/conta" element={<RequireAuth><AccountPage /></RequireAuth>} />
        <Route path="*" element={<p className="text-center">Página não encontrada.</p>} />
      </Routes>
    </Shell>
  )
}
