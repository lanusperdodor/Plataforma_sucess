import { Printer, X } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { primary } from './ui.tsx'

/** Endereço público da mesa: só identifica a mesa e abre o cardápio (sem acesso administrativo). */
export function tableQrUrl(token: string): string {
  if (import.meta.env.VITE_HASH_ROUTER === '1') return `${window.location.href.split('#')[0]}#/mesa/${token}`
  return `${window.location.origin}/mesa/${token}`
}

function QrImage({ text, label }: { text: string; label: string }) {
  const [src, setSrc] = useState<string>('')
  useEffect(() => {
    let alive = true
    void QRCode.toDataURL(text, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((d) => { if (alive) setSrc(d) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [text])
  return src ? <img src={src} alt={`QR da ${label}`} width={180} height={180} className="size-44 bg-white" /> : <span className="grid size-44 place-items-center bg-muted text-xs text-ink-muted">Gerando…</span>
}

/** Folha imprimível com o QR de cada mesa (o navegador imprime só esta área). */
export function TableQrSheet({ tables, businessName, onClose }: { tables: { id: string; name: string; qrToken: string }[]; businessName: string; onClose: () => void }) {
  useEffect(() => {
    document.body.classList.add('imprimir-qr')
    return () => document.body.classList.remove('imprimir-qr')
  }, [])
  return (
    <div className="qr-print-root fixed inset-0 z-[var(--z-sheet)] overflow-y-auto bg-surface">
      <div className="qr-print-hide sticky top-0 flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3">
        <h2 className="text-lg font-bold text-ink">QR das mesas</h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} className={primary}><Printer aria-hidden="true" className="size-4" />Imprimir</button>
          <button type="button" onClick={onClose} className="pressable grid size-11 place-items-center rounded-full hover:bg-muted" aria-label="Fechar"><X aria-hidden="true" className="size-5" /></button>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
        {tables.map((t) => (
          <li key={t.id} className="flex break-inside-avoid flex-col items-center gap-2 rounded-card border border-line bg-white p-4 text-center text-black">
            <p className="text-sm font-semibold">{businessName}</p>
            <QrImage text={tableQrUrl(t.qrToken)} label={t.name} />
            <p className="text-xl font-bold">{t.name}</p>
            <p className="text-xs">Aponte a câmera para ver o cardápio</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
