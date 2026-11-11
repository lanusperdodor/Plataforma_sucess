import { HeartHandshake, MessagesSquare, ShieldCheck, Users } from 'lucide-react'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { StateShell } from '../components/feedback/StateShell.tsx'
import { useCurrentCity } from '../features/location/cityStore.ts'

const RULES = [
  { icon: HeartHandshake, text: 'Elogios e críticas são bem-vindos, sempre com respeito.' },
  { icon: ShieldCheck, text: 'Ofensas, ameaças, assédio e discriminação não são tolerados.' },
  { icon: MessagesSquare, text: 'Conteúdo patrocinado será sempre identificado.' },
]

/**
 * Tucaí Conecta — rede social regional (antiga Comunidade).
 * O backend (publicações, comentários, curtidas, moderação) é implementado na Sprint 9.
 * Até lá a página informa a indisponibilidade: nenhuma interação é simulada.
 */
export function ConectaPage() {
  const { city } = useCurrentCity()
  return (
    <Page>
      <PageHeader icon={Users} title="Tucaí Conecta" subtitle={`A rede social de ${city?.name ?? 'sua região'}.`} />
      <StateShell
        icon={Users}
        role="status"
        title="O Conecta está em construção"
        description="Em breve você poderá publicar, comentar, seguir perfis e conversar com o comércio da região. Nenhuma publicação está disponível ainda."
      />
      <section aria-labelledby="conecta-regras" className="mx-auto w-full max-w-md rounded-card border border-line bg-surface p-4">
        <h2 id="conecta-regras" className="text-sm font-semibold text-ink">Regras de convivência</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {RULES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-2 text-sm text-ink-muted">
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
              {text}
            </li>
          ))}
        </ul>
      </section>
    </Page>
  )
}
