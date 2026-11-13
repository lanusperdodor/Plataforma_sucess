# Auditoria de segurança — 13/11/2026

Pergunta: alguém que abre o F12, lê ou altera o JavaScript e chama a API direto consegue ver dados privados, agir como
administrador, mexer em preços, saldos ou saques? **Resposta: não**, nos 45 cenários simulados (abaixo). O que o
navegador recebe é público por definição; toda regra que importa é conferida no banco (RLS e funções `security definer`).

## 1. O que o F12 mostra (e por que isso não é o problema)

* Ver o JavaScript no F12 é inevitável em qualquer site: o navegador precisa do código para funcionar. Bloquear F12,
  botão direito ou atalhos não protege nada (contornável em segundos) e **não foi feito**.
* Site publicado conferido (`curl`): **sem source maps** (`.map` → 404, nenhum `sourceMappingURL`), e `/.env`,
  `/.env.local`, `/package.json`, `/wrangler.jsonc`, `/src/...`, `/supabase/...`, `/.git/config`, backups → **404**.
  O Worker só entrega a pasta `dist/` (build).
* Única chave no navegador: a **publicável** do Supabase (`sb_publishable_…`), feita para ser pública. A chave
  `service_role`/`sb_secret_` **não existe** no código, no build nem no histórico do Git.

## 2. Segredos

* Varredura do histórico completo do Git: **nenhum segredo** (senha do Master, `sb_secret_`, JWT `service_role`, tokens).
  **Nada precisa ser revogado.**
* `.env.local` não é versionado (ignorado pelo Git) e só tem as variáveis públicas.
* Segredos reais ficam como segredos do Worker (Cloudflare): `PAYMENTS_INTEGRATION_KEY`, `ORS_API_KEY`/`MAPBOX_TOKEN`.
  No build, os nomes aparecem só em texto de ajuda do Painel Master (sem valor).
* Erros: o app mostra só mensagens de regra de negócio escritas de propósito (código `P0001`); qualquer outro erro do
  banco vira "Algo deu errado". O Worker responde `{ "erro": "…" }` sem stack trace.

## 3. Simulações de ataque (supabase/tests/rls_manipulacao.sql) — todas recusadas

| Quem | Tentativa | Resultado |
|---|---|---|
| Cliente 1 | mandar preço R$ 0,01 no pedido | ignorado: o servidor usa o preço do cadastro |
| Cliente 1 | quantidade negativa; criar pedido direto na tabela; alterar total, status ou preço dos itens | recusado |
| Cliente 2 | trocar o ID e ler pedido, itens ou código de entrega do Cliente 1; cancelar o pedido dele | recusado / nada retornado |
| Cliente | ler telefone de outras pessoas, papéis de outras contas, auditoria | nada retornado |
| Entregador 1 | aumentar o próprio repasse; concluir sem código; código errado | recusado |
| Entregador 1 | criar saque direto, sacar sem saldo, marcar saque como pago, usar função do Master, se autoaprovar | recusado |
| Entregador 2 (próprio) | aceitar entrega da rede; concluir pedido que não é dele | recusado |
| Empresário 2 | ver pedidos ou mudar preços da lanchonete; mexer em pedido dela | recusado |
| Empresário 1 | zerar comissão/taxa; criar cobrança paga; marcar cobrança como paga; plano Premium grátis; alterar outra loja; virar dono de outra loja | recusado |
| Funcionário | abrir o financeiro; se promover a gerente | recusado |
| Cliente | virar Master; `grant_role`; modo manutenção; apagar dados; ler financeiro e saques da plataforma | recusado |
| Visitante | ler pedidos, rastreamento, pedir saque | recusado |

Ao final o teste confere que pedido, repasse, saques e papéis continuaram intactos.

Outras suítes que cobrem segurança (todas passando): `rls_security`, `rls_orders`, `rls_couriers`, `rls_finance`,
`rls_carteira`, `rls_rastreamento`, `rls_broadcast`, `rls_notificacoes`, `rls_perfis`, `rls_catalogo`, `rls_experiencia`
(toda tabela com RLS, índices de FK, grants), `rls_payments`, `rls_ofertas`.

## 4. Cabeçalhos e abuso

* No site publicado: CSP estrita (`script-src 'self'`, sem `unsafe-inline`/`eval`, sem frames), HSTS, `nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (só geolocalização do próprio site), COOP/CORP.
* XSS: React escapa todo texto; o código não usa HTML cru nem `eval` (teste `src/security/xss.test.tsx`).
* CSRF: a API usa token no cabeçalho `Authorization` (não cookie), então requisição forjada de outro site não leva login.
* Limite de tentativas no banco em mais de 60 operações (login, pedido, status, aceite, saque, aprovação de saque,
  localização, convites, ações do Master…). O Supabase Auth tem limites próprios.
* Dependências: `npm audit` sem vulnerabilidades.

## 5. Correções feitas nesta auditoria (código; nada publicado)

1. `vite.config.ts`: `sourcemap: false` e `minify: true` explícitos, e remoção de comentários `sourceMappingURL` de
   arquivos de bibliotecas (o worker do MapLibre apontava para um `.map` inexistente).
2. `scripts/check-secrets.mjs` (roda no CI): falha se o build tiver `.map` ou referência a source map.
3. `RouteBoundary`: detalhes técnicos de erro no console só em desenvolvimento.
4. Teste novo `rls_manipulacao.sql` (45 cenários de ataque com as contas de homologação).

## 6. Riscos e pendências (dependem de decisão ou configuração manual)

* **ALTO (financeiro, regra de negócio):** a carteira do entregador (0036) paga R$ 5 por entrega, mas a Tucaí hoje só
  cobra da loja comissão + R$ 1. É um problema do modelo de cobrança, não de invasão; está descrito na proposta de
  frete e precisa da decisão sobre o repasse **antes de aplicar a 0036 em produção**.
* **Configurações do Supabase (conferir no painel; não auditáveis daqui):** proteção contra senhas vazadas
  (Auth → Password security), MFA obrigatório para o Master (`require_admin_mfa = true` em produção), limites de
  taxa do Auth, confirmação de e-mail, Site URL/Redirect URLs, e Security Advisor sem alertas.
* **Cloudflare (opcional, conforme o plano):** regra de limite de taxa no WAF para `/api/*` e modo anti-robô.
* O plano gratuito do openrouteservice e o OpenFreeMap são serviços de terceiros: conferir os termos de uso comercial.
