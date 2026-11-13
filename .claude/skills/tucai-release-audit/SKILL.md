---
name: tucai-release-audit
description: "Auditoria de lançamento da Tucaí (somente leitura). Use antes de cada release, merge para main ou publicação no Cloudflare, e quando pedirem 'auditar', 'está pronto para produção?', 'checklist de lançamento', 'release audit' ou 'posso publicar?'. Verifica segurança do Supabase, RLS, login Google OAuth, permissões, migrations PostgreSQL, fluxos de cliente/empresário/funcionário/entregador/Master, pedidos, pagamentos e repasses, testes automatizados, responsividade, SEO e compatibilidade com Cloudflare Workers. Roda os testes locais, gera relatório com gravidade e checklist de aprovação. Nunca altera produção."
---

# Auditoria de lançamento da Tucaí

Auditoria **somente leitura** que responde uma pergunta: _esta versão pode ir para produção?_
A resposta sai em um relatório com problemas classificados por gravidade e um checklist de aprovação.

## Regras invioláveis

1. **Nada em produção.** Não aplicar migrations no Supabase remoto, não fazer deploy (`wrangler deploy`, merge para `main`,
   publicar artefato), não alterar configurações do Supabase, Google Cloud, Cloudflare ou Mercado Pago, não excluir nem
   criar dados reais. Leitura pública anônima (GET no site publicado) é permitida; escrita, nunca.
2. **Nenhum segredo** em comandos, relatórios ou commits (senha Master, Client Secret do Google, service_role,
   tokens do Mercado Pago). Credenciais de homologação só por variável de ambiente, nunca impressas.
3. **Não corrigir durante a auditoria.** A skill encontra e reporta; correções são uma tarefa separada, pedida pela pessoa.
   Preserve a arquitetura e as funcionalidades atuais: a auditoria não remove, desativa nem "simplifica" nada.
4. **Não declarar pronto** enquanto houver: falha CRÍTICA, falha de autenticação/autorização, teste automatizado vermelho,
   ou fluxo essencial **não testado**. "Não testado" nunca conta como "aprovado"; registre como BLOQUEANTE.
5. Relate os fatos com a saída dos comandos. Se um passo não pôde rodar (sem PostgreSQL, sem credenciais), diga isso.

## Ferramentas que já existem (reutilize, não duplique)

| Necessidade                                                      | Use                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Regras e boas práticas do Supabase/Auth/RLS                      | skill `supabase` (`.claude/skills/supabase`)                                         |
| Migrations, índices, RLS, funções SQL                            | skill `supabase-postgres-best-practices`                                             |
| Revisão de segurança do diff do branch                           | skill `security-review` (se disponível na sessão)                                    |
| Bugs no diff                                                     | skill `code-review` (se disponível)                                                  |
| Revisão de segurança do diff (Trail of Bits)                     | skill `differential-review` (instalada no repositório)                               |
| APIs e configurações perigosas                                   | skill `sharp-edges` (instalada)                                                      |
| Direção visual, aparência genérica de IA                         | skill `frontend-design` (instalada)                                                  |
| Regras de interface web (acessibilidade, formulários, navegação) | skill `web-design-guidelines` (instalada; busca as regras atualizadas a cada uso)    |
| Desempenho React                                                 | skill `vercel-react-best-practices` (instalada; ignore regras exclusivas de Next.js) |
| Acessibilidade WCAG                                              | skill `design:accessibility-review` (se disponível)                                  |
| Tipos, lint, testes, build                                       | `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`               |
| Segredos no código e no build                                    | `npm run check-secrets`                                                              |
| Tamanho do carregamento inicial                                  | `npm run check-bundle` (depois do build)                                             |
| Migrations + testes de RLS em PostgreSQL **local descartável**   | `npm run test:sql` (precisa de `PG_BIN`; nunca toca o remoto)                        |
| Pacote idempotente das migrations                                | `npm run sql:bundle` → `supabase/admin/apply_all_migrations.sql`                     |
| Vulnerabilidades de dependências                                 | `npm run audit:deps`                                                                 |
| Ponta a ponta na interface com as 7 contas de homologação        | `scripts/e2e-homologacao.mjs` (só com variáveis `E2E_*`; nunca contra dados reais)   |
| CI (mesmos passos, no GitHub)                                    | `.github/workflows/ci.yml` (jobs `app` e `database`)                                 |

Esta skill acrescenta só o que faltava:

- `scripts/static-audit.mjs`: varredura estática de SQL (RLS, SECURITY DEFINER, grants a `anon`, numeração e pacote das
  migrations), frontend (service_role/Admin API, HTML inseguro, autorização só no cliente), Worker, OAuth e SEO.
- `scripts/responsive-audit.cjs`: Playwright em várias larguras (celular → TV) procurando rolagem horizontal, erros no
  console, `<title>`, descrição e `<h1>`; usa um build com backend falso, então não faz chamadas ao Supabase.

Execute os scripts a partir da raiz do repositório.

## As 12 áreas (todas entram no relatório; nenhuma pode ficar sem situação)

| #   | Área                 | O que verificar                                                                                                                                 | Como (skill / ferramenta)                                                                                         | Passo   |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Segurança            | segredos, service_role/Admin API, XSS, injeção, rate limit, cabeçalhos, dependências                                                            | `static-audit.mjs`, `check-secrets`, `audit:deps`, `differential-review`, `sharp-edges`, `security-review`        | 2, 3, 4 |
| 2   | Testes dos usuários  | as 7 contas (Empresário 1 e 2, Funcionário, Entregador 1 independente, Entregador 2 próprio, Cliente 1 e 2) + Master separado                   | testes SQL por perfil, `e2e-homologacao.mjs` em homologação                                                       | 6       |
| 3   | Banco de dados       | migrations, RLS, constraints, índices, FKs, views, concorrência, idempotência                                                                   | `test:sql`, pacote aplicado 2×, `supabase-postgres-best-practices`                                                | 2, 4    |
| 4   | Operações comerciais | pedido → preparo → entrega → conclusão; repasse cliente + loja = entregador + Tucaí; carteira 7 dias e saques; planos Premium; caixa e comandas | `rls_orders`, `rls_gestao`, `rls_carteira`, `rls_finance`, e2e                                                    | 6, 7    |
| 5   | Revisão de código    | diff contra `origin/main`, código morto, duplicação, erros silenciosos                                                                          | `code-review`, `differential-review`, lint/typecheck                                                              | 1, 2    |
| 6   | Performance          | tamanho do carregamento inicial, divisão por rota, imagens, renderizações                                                                       | `check-bundle`, `vercel-react-best-practices`, Lighthouse se disponível (Chromium em `/opt/pw-browsers/chromium`) | 8       |
| 7   | Design e UX          | consistência, contraste, foco de teclado, toque ≥ 44 px, sem rolagem horizontal, claro/escuro, aparência genérica                               | `responsive-audit.cjs`, `web-design-guidelines`, `frontend-design`, `design:accessibility-review`                 | 8       |
| 8   | SEO                  | títulos, descrições, canonical, robots, sitemap, Open Graph, dados estruturados, noindex fora do domínio                                        | `static-audit.mjs`, `responsive-audit.cjs`, `docs/SEO.md`, `curl -sI` público                                     | 8       |
| 9   | Deploy               | `wrangler.jsonc`, Worker sem APIs do Node, variáveis e segredos (só nomes), CI verde, migrations pendentes listadas                             | `static-audit.mjs`, testes `src/worker`, CI do PR                                                                 | 9       |
| 10  | Monitoramento        | `observability` do Worker, `/api/health`, alertas, onde ver erros (`docs/OPERACAO.md`)                                                          | leitura de config + GET público em `/api/health`                                                                  | 9       |
| 11  | Backup e recuperação | plano do Supabase com backup/PITR **confirmado pela pessoa**, roteiro de restauração, `manutencao_recuperar.sql`                                | `docs/OPERACAO.md`; sem confirmação → BLOQUEANTE                                                                  | 9       |
| 12  | LGPD                 | consentimento antes de rastreamento, inventário de armazenamento local, política de privacidade, exportação/exclusão de dados, logs sem senha   | `docs/LGPD.md`, `src/features/legal/inventory.ts` e testes, `ConsentManager`                                      | 8       |

## Procedimento

Crie a pasta do relatório: `release-audit/<AAAA-MM-DD-HHMM>/` (já está no `.gitignore`; não versionar).
Salve a saída de cada passo como `NN-nome.log` e anote **passou / falhou / não executado (motivo)**.

### 1. Contexto

- `git status --short`, `git log --oneline -5`, branch atual, diff contra `origin/main` (`git diff --stat origin/main...HEAD`).
- Última migration em `supabase/migrations/` e qual o relatório anterior diz estar aplicada em produção
  (`docs/HOMOLOGACAO.md`). **Não consulte o banco remoto para descobrir.** Se não souber, pergunte à pessoa e registre.

### 2. Testes automatizados (obrigatório)

```bash
npm run typecheck
npm run lint
npx vitest run
npm run build
npm run check-bundle
npm run check-secrets
npm run audit:deps
```

SQL em banco local descartável (no container como root, o PostgreSQL precisa de usuário sem privilégio):

```bash
PG_BIN=/usr/lib/postgresql/16/bin npm run test:sql
```

Se rodar como root: `chmod -R o+rX supabase scripts && su postgres -s /bin/bash -c "cd $PWD && PG_BIN=/usr/lib/postgresql/16/bin TMPDIR=/tmp node scripts/test-sql.mjs"`.
Sem PostgreSQL disponível: marque "SQL não executado localmente" e confira se o job `database` da CI passou no último
commit (veja o PR). Sem nenhuma das duas evidências → BLOQUEANTE.

Confirme também que `npm run sql:bundle` não muda o arquivo versionado (`git diff --exit-code supabase/admin/apply_all_migrations.sql`)
e, se houver PostgreSQL, aplique o pacote **duas vezes** num banco local novo para provar a idempotência.

### 3. Varredura estática

```bash
node .claude/skills/tucai-release-audit/scripts/static-audit.mjs --out release-audit/<pasta>/static.json
```

A varredura é heurística (lê o texto das migrations); a prova definitiva é o catálogo real verificado por `supabase/tests/rls_experiencia.sql` no passo 2 (toda tabela com RLS, índices de FK, grants). Se as duas discordarem, vale o teste SQL. Cada achado já vem com gravidade sugerida. Revise manualmente os ALTO/CRÍTICO (pode haver falso positivo; diga por quê).

### 4. Supabase, RLS e permissões (leitura do código, apoiada pelas skills do Supabase)

Confira, citando arquivo:linha:

- Toda tabela em `public` com RLS ativa e política coerente; nenhuma `SELECT` irrestrita em `public.businesses`;
  `public_businesses` com `security_invoker` lendo `business_catalog`.
- Funções `SECURITY DEFINER` com `set search_path = ''`, `revoke ... from public, anon` e checagem de papel no início
  (`private.require_master`, `require_permission`, `has_business_permission`, `require_active_courier`).
- Nenhuma checagem de permissão **só** no frontend: cada ação sensível tem guarda no banco.
- Frontend nunca usa `service_role`, Admin API (`auth.admin`) nem chave secreta; o bundle só tem a chave publicável.
- Master: ações sensíveis exigem MFA quando `require_admin_mfa` está ligado; senhas nunca exibidas nem registradas.
- Contas de teste isoladas (`is_test`, `viewer_sees_tests`), exatamente 7 contas padrão, sem privilégio administrativo.
- Os testes SQL de cada perfil existem e passaram: `rls_perfis`, `rls_sete_contas`, `rls_orders`, `rls_couriers`,
  `rls_gestao`, `rls_finance`, `rls_carteira`, `rls_security`, `rls_catalogo`, `rls_manutencao`.

### 5. Login e Google OAuth (sem alterar configuração)

- Código: `src/features/auth/signIn.ts` usa `redirectTo` na origem atual + `/entrar`; `oauthReturnError` trata o retorno;
  login único aceita usuário ou e-mail (`resolve_login`).
- Configuração manual (só listar para a pessoa conferir, nunca alterar): Google Cloud com o redirect
  `https://<projeto>.supabase.co/auth/v1/callback`; Supabase Auth com provedor Google ligado, **Site URL** = domínio de
  produção e **Redirect URLs** com o domínio + `/entrar`. Guia: `docs/LOGIN_GOOGLE.md`.
- Teste público (somente leitura): abrir `/entrar` no site publicado e verificar que o botão Google existe e que a URL
  de autorização aponta para o Supabase do projeto (não seguir o login sem a pessoa).
- Se não houve um login Google real confirmado pela pessoa nesta versão → item "não testado" (BLOQUEANTE para auth).

### 6. Fluxos essenciais por perfil

Para cada fluxo, a evidência aceita é teste automatizado que passou (SQL/Vitest) **ou** e2e/prova manual registrada.

| Perfil                                                                                                              | Fluxo                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Cliente                                                                                                             | ver lojas da cidade, carrinho, pedido (retirada, entrega própria, parceira), acompanhar status e código               |
| Empresário                                                                                                          | painel Gestão, aceitar/preparar/pronto, cardápio, horários, equipe, caixa/comandas (Premium), relatórios, calculadora |
| Funcionário                                                                                                         | só atendimento/cozinha; sem financeiro sem permissão extra                                                            |
| Entregador parceiro                                                                                                 | ficar disponível, oferta, aceitar, coletar, código, concluir; ganhos guardados 7 dias e saque                         |
| Entregador próprio                                                                                                  | só entregas atribuídas pela loja                                                                                      |
| Master                                                                                                              | pedidos, estabelecimentos, entregadores, financeiro (quem pagou/recebeu), saques, logins de teste, manutenção         |
| Regra de dinheiro da entrega parceira: cliente + estabelecimento = entregador + Tucaí (valores gravados no pedido). |
| Com credenciais de homologação disponíveis (variáveis `E2E_*`), rode `node scripts/e2e-homologacao.mjs` contra o    |
| ambiente de **homologação** indicado pela pessoa; nunca crie pedidos em lojas reais.                                |

### 7. Pagamentos

- Webhook do Mercado Pago no Worker (`src/worker/payments.ts`) valida assinatura e não confia no cliente; tokens só em
  segredos do Worker. Testes `src/worker/payments.test.ts` passaram. Sem credenciais de sandbox → "pagamento online não testado".

### 8. Responsividade, acessibilidade e SEO

```bash
node .claude/skills/tucai-release-audit/scripts/responsive-audit.cjs --out release-audit/<pasta>/responsivo
```

Abra 2–3 capturas (celular e desktop, claro e escuro) e olhe de verdade. Se `design:accessibility-review` existir,
use-o nas telas principais. SEO: Worker gera `/robots.txt`, `/sitemap.xml`, `noindex` fora do domínio canônico,
metadados por rota (`docs/SEO.md`). Leitura pública opcional no site publicado: `curl -sI` nas rotas e em `/api/health`.

### 9. Cloudflare Workers

- `wrangler.jsonc`: `main`, `compatibility_date`, `assets.binding = ASSETS`, `run_worker_first`, `SITE_URL` correto.
- Worker sem APIs exclusivas do Node em código de produção; testes `src/worker/*.test.ts` passaram.
- Atualizar a página várias vezes não pode dar tela branca (cabeçalhos condicionais removidos em `shellRequest`).
- **Não executar** `wrangler deploy`. `npx wrangler deploy --dry-run` só se o wrangler já estiver instalado e sem login.

## Gravidade

| Nível                        | Quando                                                                                                     | Efeito                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------- |
| **CRÍTICO**                  | vazamento de dados/segredo, RLS ausente, escalada de privilégio, dinheiro calculado errado, perda de dados | bloqueia                   |
| **ALTO**                     | login/OAuth quebrado, fluxo essencial falhando, teste vermelho, migration não idempotente                  | bloqueia                   |
| **BLOQUEANTE (não testado)** | fluxo essencial ou autenticação sem evidência nesta versão                                                 | bloqueia até ter evidência |
| **MÉDIO**                    | erro de UX que tem contorno, responsividade quebrada numa largura, SEO incompleto                          | corrigir em breve          |
| **BAIXO**                    | cosmético, texto, melhoria                                                                                 | backlog                    |

## Relatório (salvar em `release-audit/<pasta>/RELATORIO.md` e resumir na resposta)

```
# Auditoria de lançamento — <data> — <commit curto>
Veredito: APROVADO | REPROVADO | APROVADO COM RESSALVAS (só se não houver CRÍTICO/ALTO/BLOQUEANTE)
Ambiente auditado: branch, commit, última migration local, migration aplicada em produção (fonte)

## Resultado dos testes
| Passo | Resultado | Evidência |   (passou / falhou / não executado + motivo)

## Situação das 12 áreas
| # | Área | Situação (aprovada / com falhas / não verificada) | Resumo |

## Falhas críticas
## Falhas altas
## Falhas médias
| # | Área | Descrição | Arquivo:linha | Como reproduzir | Sugestão |

## Melhorias recomendadas (baixo)

## Testes executados e evidências disponíveis
| Teste | Comando | Resultado | Evidência (log/captura) |

## Pendências (não testado / depende da pessoa)

## Condições para lançamento
O que precisa ser verdade para liberar: lista objetiva, cada item ligado a uma falha ou pendência acima.

## Problemas (detalhe)
| # | Gravidade | Área | Descrição | Arquivo:linha | Como reproduzir | Sugestão |

## Fluxos essenciais
| Perfil | Fluxo | Evidência | Situação |

## Checklist de aprovação para produção
- [ ] typecheck, lint, Vitest e build verdes
- [ ] testes SQL locais (ou job `database` da CI) verdes, incluindo RLS de todos os perfis
- [ ] pacote de migrations idempotente e versionado igual ao gerado
- [ ] nenhum segredo no código/bundle; frontend sem service_role/Admin API
- [ ] RLS e guardas no banco para toda ação sensível; nenhuma autorização só no frontend
- [ ] login com usuário/e-mail e Google OAuth testados nesta versão (Site URL e Redirect URLs conferidas pela pessoa)
- [ ] fluxos de cliente, empresário, funcionário, entregador (parceiro e próprio) e Master com evidência
- [ ] repasse de entrega confere (cliente + estabelecimento = entregador + Tucaí) e saques funcionam
- [ ] pagamentos: webhook validado; online testado em sandbox ou marcado como não testado
- [ ] sem rolagem horizontal de 360 px a 2560 px; claro e escuro conferidos
- [ ] SEO: título, descrição, robots, sitemap, noindex fora do domínio canônico
- [ ] Worker: configuração válida, sem tela branca ao recarregar, /api/health ok
- [ ] monitoramento: observabilidade do Worker ativa, /api/health ok e onde ver erros documentado
- [ ] backup: plano do Supabase com backup (e PITR para dados financeiros) confirmado pela pessoa; roteiro de restauração conhecido
- [ ] LGPD: consentimento antes de rastreamento, inventário de armazenamento atualizado, exportação e exclusão de dados funcionando
- [ ] migrations pendentes listadas para a pessoa aplicar manualmente (a skill não aplica)
- [ ] deploy autorizado explicitamente pela pessoa (a skill não publica)

## Ações manuais para a pessoa (a skill não executa)
<migrations a aplicar, configurações a conferir, testes manuais a fazer>
```

Termine sempre com o veredito e a lista do que impede a aprovação. Se algo não pôde ser verificado, o veredito não é APROVADO.
