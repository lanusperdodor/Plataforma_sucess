import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App.tsx'
import { SessionCacheGuard } from './app/SessionCacheGuard.tsx'
import { ToastProvider } from './components/feedback/Toast.tsx'
import { AuthProvider } from './features/auth/AuthProvider.tsx'
import { LiveUpdates } from './features/realtime/LiveUpdates.tsx'
import './styles/tokens.css'

// Prévia estática (página hospedada sem servidor de rotas): VITE_HASH_ROUTER=1 usa rotas por '#'.
const Router = import.meta.env.VITE_HASH_ROUTER === '1' ? HashRouter : BrowserRouter

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <AuthProvider>
          <ToastProvider>
            <SessionCacheGuard />
            <LiveUpdates />
            <App />
          </ToastProvider>
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  </StrictMode>,
)
