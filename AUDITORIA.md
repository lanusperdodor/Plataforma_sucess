# Auditoria — Sprint 1 (11/11/2026)

Estado real do repositório na branch `feat/fundacao-fase-1`. Classificação usada:
**FUNCIONAL (local)** = operação principal implementada e verificada por testes automatizados em PostgreSQL 16 descartável e Vitest, **sem validação no Supabase real**;
**PARCIAL**; **NÃO INICIADO**; **BLOQUEADO POR DEPENDÊNCIA**.
Nada aqui foi testado em produção.

## 1. Demonstrações encontradas e destino

| Item | Tipo | Destino |
|---|---|---|
| `src/features/catalog/demo-data.ts` + fallback automático em `repository.ts` / `lib/data-source.ts` | dados fictícios em produção (6 restaurantes, lojas, avaliações) | **removidos**; tabela ausente agora gera erro `unavailable` ("serviço em configuração") |
| `src/features/demo/preview-data.ts` (posts, vagas, pedidos, notificações) | dados fictícios em produção | **removido**; páginas mostram estados vazios reais |
| `src/features/preview/*` + rota `/previa` | protótipo navegável inteiro simulado | **removido** |
| `DemoBanner`, selos "Demonstração", `DemoTag` | avisos visuais | **removidos** depois de retirar os dados |
| Prévia da Comunidade na Home e contagens fictícias em Explorar | blocos simulados | **removidos** |
| Curtir/salvar/seguir e "Candidatar" só na tela | botões sem efeito | **removidos** (Conecta e Vagas informam indisponibilidade) |
| `supabase/seed/demo_itau_de_minas.sql` | seed fictício de desenvolvimento | **removido**; migration 0003 esconde do público qualquer linha `is_demo` que exista no banco |
| `src/test/fakeSupabase.ts`, fixtures `7777…`/`8888…` nos testes SQL | recursos de teste | **preservados** (fora do bundle; verificado por busca no `dist/`) |

## 2. Supabase e migrations

- `0001` fundação (perfis, papéis, empresas, membros, auditoria, RLS) e `0002` catálogo — existentes.
- `0003` **nova**: público vê só dados reais (`is_demo` invisível), taxonomia oficial de categorias, cidade inicial sem coordenadas inventadas.
- `0004` **nova**: estado `rejected` para estabelecimentos.
- `0005` **nova**: Painel Master — configurações, permissões por integrante, MFA (aal2), solicitação/análise de estabelecimentos, cidades, equipe, auditoria.
- Testes: `rls_foundation.sql`, `rls_experiencia.sql`, `rls_admin.sql` (novo, ~80 verificações) passam em PostgreSQL 16 local. Controle negativo feito (remover a trava de autoaprovação faz o teste falhar).
- **Nenhuma migration foi aplicada no Supabase remoto.** Estado remoto desconhecido.

## 3. Acesso administrativo

- `/admin/entrar` usa o Supabase Auth normal; com papel Master/operador vindo do banco segue para `/admin`.
- Não há senha fixa nem atalho. Cadastro público só gera `customer`; papéis só via `grant_role` (Master + MFA quando exigido).
- Operadores começam **sem nenhuma permissão**; o Master libera uma a uma (auditado). Ninguém altera as próprias permissões nem analisa um negócio do qual faz parte.
- MFA TOTP: tela de cadastro/verificação pronta; a exigência (`require_admin_mfa`) só pode ser ligada por um Master já em aal2.
- Primeiro Master: `supabase/admin/bootstrap_first_master.sql` (manual, uma vez, no SQL Editor).

## 4. Estado dos 21 módulos

| # | Módulo | Estado | Observação |
|---|---|---|---|
| 1 | Delivery | NÃO INICIADO | Catálogo de leitura existe; carrinho, checkout e pedidos não. |
| 2 | Loja personalizada | PARCIAL | Colunas (logo, capa, descrição, horários) e cardápio no banco; página pública da loja ainda "em construção"; sem cores. |
| 3 | Painel do restaurante | NÃO INICIADO | RBAC por empresa existe no banco (`business_members`, `role_permissions`). |
| 4 | Meu Lucro | NÃO INICIADO | |
| 5 | Entregadores | NÃO INICIADO | Entrada clara criada (menu lateral, Explorar) informando que o cadastro ainda não abriu. |
| 6 | Distribuição de entregas | NÃO INICIADO | |
| 7 | Pagamentos e repasses | BLOQUEADO POR DEPENDÊNCIA | Falta escolher e contratar o provedor (Pix/cartão). |
| 8 | Cupons e fidelidade | NÃO INICIADO | |
| 9 | Avaliações | PARCIAL | Tabela de leitura; sem criação verificada nem moderação. |
| 10 | Multicidades | PARCIAL | Seleção manual + gestão de cidades pelo Master (FUNCIONAL local). Sem geolocalização e raio de 200 km. |
| 11 | Shopping regional | PARCIAL | Listagem de lojas por categoria; sem produtos/carrinho. |
| 12 | Serviços e agenda | PARCIAL | Listagem; sem agenda/reservas. |
| 13 | Tucaí Conecta | NÃO INICIADO | Renomeado (rota `/conecta`, `/comunidade` redireciona); sem backend. |
| 14 | Vagas | NÃO INICIADO | |
| 15 | Publicidade | NÃO INICIADO | |
| 16 | Segurança e LGPD | PARCIAL | Auth, RLS, auditoria imutável, MFA preparado, testes SQL; sem rate limit de API, storage de documentos, rotinas LGPD. |
| 17 | Painel Master | FUNCIONAL (local) — parcial no escopo | Painel geral, estabelecimentos (aprovar/recusar/suspender/reativar), cidades, equipe e permissões, auditoria, segurança/MFA. Demais áreas entram com seus módulos. |
| 18 | Regras comerciais | PARCIAL | `pricing.ts` + `pricing_configs` versionada e imutável após uso; falta o motor de pedidos no backend. |
| 19 | Etapas de crescimento | — | Estratégia; seguida na ordem das sprints. |
| 20 | Identidade e UX | PARCIAL | Shell responsivo, menu lateral e barra inferior; redesign completo é a Sprint 8. |
| 21 | Complementares | NÃO INICIADO | |

Cadastro de estabelecimento pelo comerciante (`/cadastrar-negocio`): **FUNCIONAL (local)** — envio, limite anti-spam, acompanhamento do status e motivo da recusa.

## 4b. Módulos 22–26 (adicionados em 11/11/2026)

| # | Módulo | Estado | Observação |
|---|---|---|---|
| 22 | Precificação comparativa (efeito chamariz) | NÃO INICIADO | Depende do catálogo real e do motor de preços no backend (Sprints 3–4). Regras de transparência já nos termos. |
| 23 | Segurança da aplicação | PARCIAL (etapa 1 concluída) | Ver `docs/SEGURANCA.md`. |
| 24 | Privacidade e LGPD | PARCIAL | Direitos do titular FUNCIONAL (local); políticas em minuta; dados institucionais pendentes. `docs/LGPD.md`. |
| 25 | Transparência comercial | PARCIAL | Termos em minuta; transparência de preço depende do checkout. |
| 26 | Segurança operacional | PARCIAL | CI, Dependabot, procedimentos; backups e monitoramento dependem do plano/fornecedor. `docs/OPERACAO.md`. |

Checklist classificado: `docs/CONFORMIDADE.md`.

## 5. Limitações conhecidas

- Bundle inicial 575 kB (meta 450 kB; Supabase no carregamento inicial) — Sprint 12.
- `distance_estimate_km` e `popularity_score` não têm origem real ainda; a Home não ordena mais por distância.
- `CONTINUAR_NO_KIRO.md` e `REVISAO_LOCAL.md` são histórico de sessões anteriores.
