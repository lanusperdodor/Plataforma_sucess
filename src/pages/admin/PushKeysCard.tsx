import { useQuery } from '@tanstack/react-query'
import { BellRing, CheckCircle2, Copy } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '../../components/feedback/toast-context.ts'
import { getPushPublicKey } from '../../features/push/repository.ts'
import { primaryButton, secondaryButton } from './ui.tsx'

const b64url = (b: ArrayBuffer | Uint8Array) => {
  let s = ''
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Gera as chaves VAPID no próprio navegador (nada é enviado). A privada aparece uma vez para ir ao Cloudflare. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const raw = await crypto.subtle.exportKey('raw', kp.publicKey)
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
  return { publicKey: b64url(raw), privateKey: jwk.d! }
}

export function PushKeysCard({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null)
  const live = useQuery({ queryKey: ['push', 'chave-publica'], queryFn: getPushPublicKey, staleTime: 60_000 })
  const copy = (t: string) => void navigator.clipboard?.writeText(t).then(() => toast.success('Copiado.'), () => undefined)
  return (
    <section aria-labelledby="push-chaves" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:p-6">
      <h2 id="push-chaves" className="flex items-center gap-2 text-lg font-semibold text-ink"><BellRing aria-hidden="true" className="size-5" />Aviso de corrida com o app fechado (Web Push)</h2>
      {live.data ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 aria-hidden="true" className="size-4" />Ativo: o servidor já tem as chaves. Os entregadores podem ligar os avisos na Área do entregador.</p>
      ) : (
        <p className="text-sm text-ink-muted">Ainda não ativado. Gratuito. Também é preciso ter a chave de integração (passo 2 acima) cadastrada no Cloudflare.</p>
      )}
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
        <li>Clique em <strong>Gerar chaves</strong> (geradas neste navegador; nada é enviado).</li>
        <li>No Cloudflare → Workers → <strong>plataforma-sucess</strong> → Settings → Variables and Secrets, crie dois itens do tipo <strong>Secret</strong>: <code>VAPID_PUBLIC_KEY</code> e <code>VAPID_PRIVATE_KEY</code>, colando cada valor.</li>
        <li>Pronto: em até 1 minuto esta tela mostra “Ativo”. Trocar as chaves depois exige que os entregadores liguem os avisos de novo.</li>
      </ol>
      {canEdit && (
        <button type="button" onClick={() => void generateVapidKeys().then(setKeys)} className={`${primaryButton} w-fit`}>Gerar chaves</button>
      )}
      {keys && (
        <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
          {([['VAPID_PUBLIC_KEY', keys.publicKey], ['VAPID_PRIVATE_KEY', keys.privateKey]] as const).map(([name, v]) => (
            <div key={name} className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-ink">{name}</span>
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all rounded-lg bg-muted px-2 py-1 text-xs text-ink">{v}</code>
                <button type="button" onClick={() => copy(v)} className={secondaryButton}><Copy aria-hidden="true" className="size-4" />Copiar</button>
              </div>
            </div>
          ))}
          <p className="text-xs text-danger">A chave privada aparece só agora. Não envie por mensagem e não salve em arquivos; cole direto no Cloudflare.</p>
        </div>
      )}
    </section>
  )
}
