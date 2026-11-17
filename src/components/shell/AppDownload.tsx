import { Download, Smartphone } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { BRAND } from '../../config/brand.ts'
import { runningAsApp } from '../../features/app/installed.ts'

const hidden = (path: string) => path === '/app' || runningAsApp()

/** Celular: faixa fina bem no topo, acima do cabeçalho, com o convite para baixar o app. */
export function AppDownloadStrip() {
  const { pathname } = useLocation()
  if (hidden(pathname)) return null
  return (
    <div className="relative z-40 flex items-center gap-3 bg-[#17191B] px-3 py-2 text-white">
      <img src={BRAND.assets.icon} alt="" width={36} height={36} className="size-9 shrink-0 rounded-xl ring-1 ring-white/15" />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-bold">Baixe o app da Tucaí</p>
        <p className="truncate text-xs text-white/70">Android e iPhone · grátis</p>
      </div>
      <Link to="/app" className="pressable inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-orange px-4 text-sm font-bold text-ink">
        <Download aria-hidden="true" className="size-4" />Baixar
      </Link>
    </div>
  )
}

/** Computador/tablet: botão "Baixar app" no cabeçalho. */
export function AppDownloadButton() {
  const { pathname } = useLocation()
  if (hidden(pathname)) return null
  return (
    <Link to="/app" className="pressable inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-orange px-4 text-sm font-bold text-ink shadow-sm">
      <Smartphone aria-hidden="true" className="size-4" />Baixar app
    </Link>
  )
}
