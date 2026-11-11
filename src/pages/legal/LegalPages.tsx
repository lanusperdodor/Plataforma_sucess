import { FileText, HardDrive, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Page, PageHeader } from '../../components/nav/PageHeader.tsx'
import { LEGAL, PENDING, legalValue } from '../../config/legal.ts'
import { OPERATORS, PROCESSING, STORAGE_ITEMS, USES_NON_ESSENTIAL_TRACKING } from '../../features/legal/inventory.ts'
import { removeStorage } from '../../lib/storage.ts'

function Doc({ icon, title, subtitle, children }: { icon: LucideIcon; title: string; subtitle: string; children: ReactNode }) {
  return (
    <Page>
      <PageHeader icon={icon} title={title} subtitle={subtitle} />
      <p role="note" className="rounded-card border border-warm bg-warm-soft p-3 text-sm text-ink">
        Minuta em revisão jurídica. Versão {LEGAL.documentsVersion}. Os dados institucionais marcados como pendentes serão
        publicados antes da operação comercial.
      </p>
      <article className="flex max-w-prose flex-col gap-5 text-sm leading-relaxed text-ink [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </article>
    </Page>
  )
}

function Controller() {
  return (
    <dl className="grid gap-1">
      <div><dt className="inline font-semibold">Controlador: </dt><dd className="inline">{legalValue(LEGAL.controllerName)}</dd></div>
      <div><dt className="inline font-semibold">CNPJ: </dt><dd className="inline">{legalValue(LEGAL.cnpj)}</dd></div>
      <div><dt className="inline font-semibold">Endereço: </dt><dd className="inline">{legalValue(LEGAL.address)}</dd></div>
      <div><dt className="inline font-semibold">Encarregado (DPO): </dt><dd className="inline">{legalValue(LEGAL.dpoName)}</dd></div>
      <div><dt className="inline font-semibold">Contato de privacidade: </dt><dd className="inline">{legalValue(LEGAL.privacyContactEmail)}</dd></div>
    </dl>
  )
}

export function PrivacyPolicyPage() {
  return (
    <Doc icon={ShieldCheck} title="Política de privacidade" subtitle="Como a Tucaí trata seus dados pessoais.">
      <section aria-labelledby="pp-quem"><h2 id="pp-quem">Quem é o responsável</h2><Controller /></section>
      <section aria-labelledby="pp-dados">
        <h2 id="pp-dados">Dados, finalidades e bases legais</h2>
        <p>Coletamos apenas o necessário para cada finalidade. Nem todo tratamento depende de consentimento; a base legal de cada um está indicada abaixo.</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-xs">
            <thead><tr className="border-b border-line">{['Dados', 'Finalidade', 'Base legal', 'Onde', 'Retenção', 'Quem acessa'].map((h) => <th key={h} scope="col" className="p-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {PROCESSING.map((p) => (
                <tr key={p.data} className="border-b border-line align-top">
                  <td className="p-2">{p.data}</td><td className="p-2">{p.purpose}</td><td className="p-2">{p.legalBasis}</td>
                  <td className="p-2">{p.systems}</td><td className="p-2">{p.retention}</td><td className="p-2">{p.access}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2">Hoje não coletamos localização em tempo real, documentos pessoais, dados de pagamento ou dados sensíveis. Quando esses recursos existirem, esta política será atualizada antes.</p>
      </section>
      <section aria-labelledby="pp-comp">
        <h2 id="pp-comp">Compartilhamento e operadores</h2>
        <ul>{OPERATORS.map((o) => <li key={o.name}><strong>{o.name}</strong> — {o.role}. {o.status}</li>)}</ul>
        <p>Transferência internacional: os operadores podem armazenar dados fora do Brasil, conforme a região contratada. {PENDING}</p>
        <p>Não vendemos dados pessoais.</p>
      </section>
      <section aria-labelledby="pp-dir">
        <h2 id="pp-dir">Seus direitos</h2>
        <p>Você pode pedir confirmação e acesso, correção, portabilidade, informação sobre compartilhamentos, revogação de consentimento, oposição e exclusão ou anonimização nos casos previstos em lei.</p>
        <p>Faça seus pedidos em <Link className="font-semibold text-brand underline" to="/perfil/privacidade">Perfil → Privacidade e dados</Link>, onde também é possível baixar uma cópia dos seus dados. Cada pedido é registrado e respondido com o resultado.</p>
        <p>Dados exigidos por lei (por exemplo, fiscais e financeiros) podem ser mantidos pelo prazo legal mesmo após a exclusão; o restante é eliminado ou anonimizado.</p>
      </section>
      <section aria-labelledby="pp-seg">
        <h2 id="pp-seg">Segurança</h2>
        <ul>
          <li>Conexões somente por HTTPS; senhas guardadas apenas como hash pelo provedor de autenticação.</li>
          <li>Acesso aos dados controlado no banco por usuário e por estabelecimento (Row Level Security).</li>
          <li>Equipe administrativa com permissões individuais, verificação em duas etapas e registro de ações.</li>
          <li>Limites de tentativas para ações sensíveis.</li>
        </ul>
        <p>Nenhum sistema é totalmente imune a incidentes. Se ocorrer um incidente com risco relevante, avaliaremos a comunicação à ANPD e aos titulares conforme a lei.</p>
      </section>
      <section aria-labelledby="pp-arm"><h2 id="pp-arm">Cookies e armazenamento local</h2><p>Veja a lista completa em <Link className="font-semibold text-brand underline" to="/armazenamento">Armazenamento local</Link>.</p></section>
    </Doc>
  )
}

export function TermsPage() {
  return (
    <Doc icon={FileText} title="Termos de uso" subtitle="Regras de uso da Tucaí para cada tipo de participante.">
      <section aria-labelledby="t-plat"><h2 id="t-plat">Sobre a plataforma</h2><Controller /><p>A Tucaí conecta consumidores a estabelecimentos, entregadores parceiros e prestadores de serviços da região. Cada estabelecimento é o fornecedor dos produtos e serviços que oferece e é identificado na sua página.</p></section>
      <section aria-labelledby="t-cons">
        <h2 id="t-cons">Consumidores</h2>
        <ul>
          <li>Antes de confirmar qualquer compra, você verá preço dos itens, adicionais, taxa de entrega, outras taxas, descontos, total e condições de pagamento. Não há cobranças ocultas.</li>
          <li>Pedidos e pagamentos online ainda não estão disponíveis; nada é cobrado nesta fase.</li>
          <li>Cancelamentos e reembolsos seguem o Código de Defesa do Consumidor e a política de reembolso abaixo.</li>
        </ul>
      </section>
      <section aria-labelledby="t-est">
        <h2 id="t-est">Estabelecimentos</h2>
        <ul>
          <li>O cadastro passa por análise; a publicação depende de aprovação. Informações da loja, preços e disponibilidade são de responsabilidade do estabelecimento e devem ser verdadeiros.</li>
          <li>Promoções e cupons são autorizados e financiados pelo próprio estabelecimento. É proibido inventar preços anteriores, descontos, estoques limitados, contadores de urgência ou afirmar “mais vendido” sem dados reais.</li>
          <li>Planos pagos: valor, periodicidade e renovação são informados antes da contratação, sem opções pré-selecionadas. O cancelamento pode ser solicitado pelo próprio painel, sem etapas desnecessárias.</li>
        </ul>
      </section>
      <section aria-labelledby="t-ent"><h2 id="t-ent">Entregadores parceiros</h2><p>Entregadores são parceiros independentes. As condições de parceria (valores, aceite de entregas, documentos exigidos) serão publicadas após validação jurídica e antes da abertura do cadastro.</p></section>
      <section aria-labelledby="t-serv"><h2 id="t-serv">Prestadores de serviços</h2><p>Cada prestador é responsável pelos serviços, preços, agenda e cancelamentos que oferece. Regras de agendamento serão publicadas com o módulo de serviços.</p></section>
      <section aria-labelledby="t-con">
        <h2 id="t-con">Conectuaí</h2>
        <ul>
          <li>Elogios e críticas são bem-vindos, com respeito. Ofensas, ameaças, assédio, discriminação e spam são proibidos e podem levar à remoção do conteúdo e à suspensão da conta, com direito a contestação.</li>
          <li>Conteúdo patrocinado é sempre identificado. Avaliações e depoimentos devem refletir experiências reais; a Tucaí não fabrica avaliações.</li>
        </ul>
      </section>
      <section aria-labelledby="t-reem">
        <h2 id="t-reem">Política de reembolso</h2>
        <p>Situações elegíveis (pedido não entregue, item errado ou faltante, cobrança indevida, cancelamento permitido), procedimento, responsável pelo atendimento e prazos serão detalhados quando os pagamentos online forem ativados. Toda solicitação terá histórico consultável. Seus direitos legais como consumidor sempre prevalecem.</p>
      </section>
      <section aria-labelledby="t-ia"><h2 id="t-ia">Inteligência artificial</h2><p>Hoje a Tucaí não usa atendimento automatizado, moderação automática, recomendações personalizadas nem decisões automatizadas por IA. Se passar a usar, isso será informado, com as limitações e um canal de revisão humana. Atendimento automatizado nunca será apresentado como humano.</p></section>
      <section aria-labelledby="t-lic"><h2 id="t-lic">Propriedade intelectual</h2><p>A marca Tucaí e o mascote Tuca pertencem à Tucaí. Estabelecimentos declaram ter direito sobre as imagens e textos que publicam.</p></section>
    </Doc>
  )
}

const CATEGORY_LABEL = { necessario: 'Estritamente necessário', preferencias: 'Preferências', estatisticas: 'Estatísticas', marketing: 'Marketing' } as const

export function StoragePolicyPage() {
  const [cleared, setCleared] = useState(false)
  const clear = () => {
    for (const item of STORAGE_ITEMS) {
      if (!item.clearable) continue
      if (item.key.includes('<')) {
        const prefix = item.key.slice(0, item.key.indexOf('<'))
        try {
          const store = item.where === 'sessionStorage' ? window.sessionStorage : window.localStorage
          Object.keys(store).filter((k) => k.startsWith(prefix)).forEach((k) => store.removeItem(k))
        } catch {
          // armazenamento indisponível: nada a apagar
        }
      } else {
        removeStorage(item.key, item.where === 'sessionStorage' ? 'session' : 'local')
      }
    }
    setCleared(true)
  }
  return (
    <Doc icon={HardDrive} title="Cookies e armazenamento local" subtitle="Tudo o que a Tucaí guarda no seu navegador.">
      <p>
        A Tucaí <strong>não usa cookies</strong>, ferramentas de estatística ou de marketing.
        {USES_NON_ESSENTIAL_TRACKING ? '' : ' Por isso não exibimos banner de consentimento: só existe armazenamento necessário ou de preferências que você controla aqui.'}
      </p>
      <ul className="!list-none !pl-0 flex flex-col gap-2">
        {STORAGE_ITEMS.map((i) => (
          <li key={i.key} className="rounded-card border border-line bg-surface p-3">
            <p className="font-semibold"><code>{i.key}</code> · {i.where}</p>
            <p className="text-ink-muted">{CATEGORY_LABEL[i.category]} — {i.purpose} Duração: {i.lifetime}</p>
          </li>
        ))}
      </ul>
      <div>
        <button type="button" onClick={clear} className="pressable inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-semibold text-ink">
          Apagar preferências e histórico deste aparelho
        </button>
        {cleared && <p role="status" className="mt-2 text-success">Preferências e histórico apagados. Sua sessão foi mantida.</p>}
      </div>
    </Doc>
  )
}
