import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BRAND } from '../config/brand.ts'

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link to="/" aria-label={`${BRAND.name} — início`} className="inline-flex min-h-11 items-center">
            <img src={BRAND.assets.logoHorizontal} alt="" width={124} height={36} className="h-9 w-auto brand-logo" />
          </Link>
          <Link to="/" className="pressable inline-flex min-h-11 items-center text-sm font-semibold text-brand">
            Voltar ao início
          </Link>
        </div>
      </header>
      <main id="conteudo" className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center">
        <div className="w-full">{children}</div>
      </main>
      <footer className="pb-6 text-center text-xs text-ink-muted">
        {BRAND.name} · {BRAND.slogan} ·{' '}
        <Link to="/privacidade" className="underline">Privacidade</Link> ·{' '}
        <Link to="/termos" className="underline">Termos</Link>
      </footer>
    </div>
  )
}