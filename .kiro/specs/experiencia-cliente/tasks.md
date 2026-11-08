# Implementation Plan: Experiência do Cliente

## Overview

A implementação segue a ordem pedida: primeiro a navegação geral e a experiência de app (tokens, AppShell, rotas lazy, toasts, dialogs), depois as telas na sequência Home, Comunidade, Restaurantes, Página do restaurante, Pedidos, Perfil, Vagas e Explorar (com Lojas, Serviços, Busca, Notificações e Sacola/Checkout). Banco (migrations 0002–0006, seed, testes SQL) e camada de repositórios entram de forma incremental, sempre antes das telas que dependem deles.

Linguagem: TypeScript (React + Vite + Supabase), definida no design. SQL para migrations e testes de RLS.

Convenções:
- Os 45 testes existentes (auth, permissões e preços) devem continuar passando em todo checkpoint.
- `src/features/preview` continua no repositório, sem rota, até a tarefa 20.1.
- Páginas ainda não implementadas ficam como placeholders criados na tarefa 2.11 e são substituídas pelas tarefas das telas (mesmo caminho de arquivo, sem editar `routes.tsx`).
- Testes de propriedade usam `fast-check` com no mínimo 100 execuções, cada um em arquivo próprio, com o comentário `Feature: experiencia-cliente, Property N: título`.
- Propriedades de banco ficam em `supabase/tests/props/*.sql`, executadas pelo `scripts/test-sql.mjs`.
- Nenhum comando de watch; testes com `npm test -- --run`.

## Tasks

- [x] 1. Fundação: utilitários, testes e tokens
  - [x] 1.1 Instalar `fast-check` e criar o cliente Supabase simulado
    - Confirmar a versão exata no registry e instalar como devDependency, sem `--force`
    - Criar `src/test/fakeSupabase.ts` (construtor encadeável com registro de consultas e `handler` configurável, no padrão de `auth-flows.test.tsx`)
    - _Requirements: 20.1, 20.3_

  - [x] 1.2 Criar `src/lib/money.ts` e `src/lib/errors.ts`
    - `formatBRL`, `parseBRL`, `assertCents`; `RepositoryError` e `mapPostgrestError` (mensagens em pt-BR)
    - Testes unitários de formatação e mapeamento de erros
    - _Requirements: 15.4, 15.5, 8.10, 20.3_

  - [ ]* 1.3 Escrever teste de propriedade para formatação de moeda
    - **Property 34: Formatação de moeda ida e volta**
    - **Validates: Requirements 15.5, 8.10**

  - [x] 1.4 Criar `src/lib/time.ts`
    - `localParts`, `isOpenNow` e `nextOpening` no fuso America/Sao_Paulo, com janelas que atravessam a meia-noite
    - Testes unitários com instantes fixos (dentro, fora, virada de meia-noite)
    - _Requirements: 5.5, 6.10, 20.3_

  - [ ]* 1.5 Escrever teste de propriedade para aberto/fechado
    - **Property 9: Aberto ou fechado no fuso de São Paulo**
    - **Validates: Requirements 5.5**

  - [ ]* 1.6 Escrever teste de propriedade para próxima abertura
    - **Property 10: Próxima abertura é o primeiro instante aberto**
    - **Validates: Requirements 6.10**

  - [x] 1.7 Criar utilitários `storage.ts`, `url-state.ts`, `a11y.ts` e `color.ts` em `src/lib`
    - `storage.ts`: leitura/gravação segura de `localStorage`/`sessionStorage` com validação zod e descarte de dado inválido
    - `url-state.ts`: helpers de `URLSearchParams` tipados
    - `a11y.ts`: `usePrefersReducedMotion`, `animateScrollTo` (300 ms por `requestAnimationFrame`, imediato com movimento reduzido)
    - `color.ts`: `contrastRatio`
    - _Requirements: 6.4, 16.9, 18.2, 15.3_

  - [x] 1.8 Estender `src/styles/tokens.css` com os tokens do design
    - Adicionar `--accent-warm`, `--accent-warm-soft`, `--text-muted`, `--border-subtle`, `--radius-lg`, `--radius-pill`, `--shadow-card`, alturas do cabeçalho, `--bottom-nav-h`, larguras do menu, `--content-max` e z-index
    - Mapear no `@theme inline`; remover o `padding-bottom: env(safe-area-inset-bottom)` do `body`
    - Garantir animações de 150 ms a 350 ms só em `transform`/`opacity`, hover só com `(hover: hover) and (pointer: fine)` e feedback `:active`
    - _Requirements: 17.1, 17.2, 17.3, 16.4, 16.5, 16.6, 16.9, 18.8_

  - [ ]* 1.9 Escrever testes estáticos de identidade e segurança
    - Contraste dos pares de tokens (4,5:1 e 3:1), ausência de cores hexadecimais em `src/**/*.tsx` e de `service_role` em `src`
    - _Requirements: 17.1, 18.2, 14.15_

  - [x] 1.10 Configurar regras ESLint de fronteira
    - `no-restricted-imports`: `lib/supabase` só em `repository.ts`, `AuthProvider` e `lib`; `features/pricing` fora de `pages` e `components`
    - _Requirements: 15.1, 8.20_

- [x] 2. Navegação geral e experiência de app
  - [x] 2.1 Criar `src/components/shell/destinations.ts`
    - `NAV_DESTINATIONS` (Início, Explorar, Comunidade, Pedidos, Perfil) com ícones Lucide e `resolveActiveDestination(pathname)`
    - Testes unitários por rota (Explorar cobre restaurantes, lojas, serviços, vagas e busca; Perfil cobre `/conta` e `/notificacoes`)
    - _Requirements: 1.1, 1.6, 1.8_

  - [ ]* 2.2 Escrever teste de propriedade para destino ativo
    - **Property 1: Destino ativo único**
    - **Validates: Requirements 1.6**

  - [x] 2.3 Criar `useBreakpoint`, `useCompactHeader` e `nextCompactState`
    - `matchMedia` com `useSyncExternalStore` (768 e 1024); listener de rolagem passivo com `requestAnimationFrame`; limiares 48 e 8
    - _Requirements: 1.1, 1.4, 1.5, 16.1, 16.2_

  - [ ]* 2.4 Escrever teste de propriedade para compactação do cabeçalho
    - **Property 37: Compactação do cabeçalho**
    - **Validates: Requirements 16.1, 16.2**

  - [x] 2.5 Criar componentes de feedback em `src/components/feedback`
    - `Skeleton*` (dimensões fixas), `EmptyState`, `ErrorState` com "Tentar novamente", `NotFoundState`, `Img` (`alt` obrigatório, lazy, dimensões reservadas)
    - _Requirements: 16.7, 16.10, 3.9, 4.5, 4.6, 17.4_

  - [x] 2.6 Criar `ToastProvider` e `useToast`
    - Fila de até 3, `role="status"` (sucesso/info) e `role="alert"` (erro), pausa em hover/foco, textos em pt-BR
    - _Requirements: 16.8_

  - [x] 2.7 Criar `Dialog` e `Sheet` em `src/components/overlays`
    - `role="dialog"`, `aria-modal`, foco preso, Esc, retorno do foco ao disparador, `inert` no fundo, travamento de rolagem
    - _Requirements: 6.7, 18.1_

  - [x] 2.8 Criar `TopBar`
    - Logo/nome de `BRAND`, espaço para localização, entrada de busca, sino, avatar (ou "Entrar") e sacola com contador; estados expandido/compacto por `data-compact` sem layout shift
    - Hooks provisórios `useCartSummary` e `useUnreadCount` (retornam 0), ligados nas tarefas 9.10 e 17.3
    - _Requirements: 1.2, 1.5, 16.1, 17.5, 18.4_

  - [x] 2.9 Criar `BottomNav`, `SideNav` e `CartFab`
    - `BottomNav` com 5 destinos, alvos ≥ 44 px, `aria-current="page"` e safe area; `SideNav` em trilho (tablet) e expandida (desktop); `CartFab` com contador e total acima da barra
    - Prefetch do chunk em hover/foco dos itens
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 18.3, 18.6, 18.7, 18.8_

  - [x] 2.10 Criar `AppShell`
    - Composição por breakpoint (mobile, tablet, desktop), landmarks `header`/`nav`/`main#conteudo`, link "Pular para o conteúdo", região `aria-live`, conteúdo com largura máxima de 1280 px e sem rolagem horizontal a 320 px
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 17.6, 18.5, 19.1_

  - [x] 2.11 Criar rotas lazy, `RouteBoundary` e atualizar `App.tsx`
    - `src/app/lazy.ts` (`lazyNamed`), `src/app/routes.tsx` com todas as rotas do mapa, `RouteBoundary` (ErrorBoundary + Suspense + skeleton de rota, erro de chunk com "Recarregar")
    - Criar páginas placeholder para as telas ainda não implementadas; rotas de autenticação em chunks próprios dentro de `AuthShell`; adicionar `ToastProvider` em `main.tsx`
    - Manter `/entrar`, `/cadastro`, `/recuperar-senha`, `/nova-senha` e `/conta` com o comportamento atual
    - _Requirements: 1.7, 1.8, 2.1, 19.2, 19.3, 19.4, 19.5, 6.11_

  - [x] 2.12 Ajustar `RequireAuth`, `safeRedirect` e criar `SessionCacheGuard`
    - `state.from = pathname + search + hash`; `safeRedirect` continua aceitando só caminhos internos
    - `SessionCacheGuard` remove `['me']` do cache ao sair ou trocar de usuário, sem tocar na Sacola
    - Garantir que os testes de `auth-flows` e `schemas` seguem passando
    - _Requirements: 2.3, 2.5, 2.6, 1.7, 15.7_

  - [ ]* 2.13 Escrever teste de propriedade para redirecionamento de login
    - **Property 2: Redirecionamento de login preserva o destino interno**
    - **Validates: Requirements 2.3, 2.5**

  - [x] 2.14 Criar `useScrollRestoration`
    - `history.scrollRestoration = 'manual'`, posição por `location.key` em `sessionStorage`, restauração em POP após sinal `ready` (até 1 s)
    - _Requirements: 16.3_

  - [x] 2.15 Configurar divisão de código e `scripts/check-bundle.mjs`
    - Ajustar `vite.config.ts` conforme a API de chunking do Vite instalado; criar `check-bundle.mjs` (soma entrada + `modulepreload` de `dist/index.html`, falha acima de 546 000 bytes); adicionar scripts `check-bundle` ao `package.json`
    - _Requirements: 19.2, 20.1_

  - [x] 2.16 Escrever testes de componente da navegação e do shell
    - `matchMedia` simulado em 375/800/1280: landmarks, 5 destinos, `aria-current`, `CartFab` só no mobile com itens
    - `RouteBoundary` com `lazy` que rejeita, `ToastProvider` (roles), `Dialog` (foco preso, Esc, retorno do foco), `RequireAuth` com `pathname + search`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 6.7, 16.8, 19.4, 20.4_

- [ ] 3. Checkpoint - Navegação e shell
  - Executar `npm run typecheck`, `npm run lint`, `npm test -- --run`, `npm run build` e `node scripts/check-bundle.mjs`
  - Confirmar que os 45 testes existentes passam. Ensure all tests pass, ask the user if questions arise.

- [x] 4. Banco: executor SQL e catálogo
  - [x] 4.1 Criar `scripts/test-sql.mjs` e `supabase/tests/supabase_default_privileges.sql`
    - Localizar binários por `PG_BIN`, `C:\Program Files\PostgreSQL\17\bin`, `...\15\bin` e `embedded-postgres`; banco temporário em `%TEMP%`; aplicar stub, privilégios padrão, migrations, seed (quando existir) e testes (`rls_foundation.sql`, `rls_experiencia.sql` e `props/*.sql`) com `ON_ERROR_STOP`; limpar ao final
    - Adicionar `npm run test:sql` ao `package.json` e validar com `rls_foundation.sql`
    - _Requirements: 14.13, 20.6_

  - [x] 4.2 Criar `supabase/migrations/0002_catalog_core.sql`
    - Enums, `cities`, `categories`, extensão de `businesses`, `business_hours`, `menu_categories`, `products`, `option_groups`, `options`, `services`, `reviews`, `pricing_configs` (linha inicial aprovada), FK de `profiles.preferred_city_id`
    - `is_active_business`, `private.is_open`, `business_is_open`, grants por coluna em `businesses` (sem `owner_id`), RLS, `revoke` explícito, FKs compostas e índices
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.10, 14.11, 2.2_

  - [x] 4.3 Criar `supabase/tests/rls_experiencia.sql` (base)
    - Helpers `tst.*`, catálogo de segurança (RLS ligado, sem `using (true)` fora de `cities`/`categories`, `business_id`, índice em FK, `search_path` vazio, `anon` sem `owner_id`), visibilidade pública do catálogo e horário (`private.is_open`)
    - _Requirements: 14.4, 14.5, 14.6, 14.10, 14.11, 14.13, 14.14_

  - [x] 4.4 Criar `supabase/seed/demo_itau_de_minas.sql` (parte 1)
    - Idempotente (UUIDs fixos): dono fictício, Itaú de Minas/MG, 10 categorias, 6 restaurantes com horários (um com janela noturna e um fechado agora) e cardápios com adicionais obrigatórios/opcionais, 3 lojas, 3 serviços, avaliações; `is_demo = true` e comentário de remoção
    - _Requirements: 14.12_

  - [x] 4.5 Adicionar verificações do seed ao `rls_experiencia.sql`
    - Contagens de cidade, categorias, restaurantes, lojas e serviços quando o seed estiver carregado
    - _Requirements: 14.12, 14.14_

- [x] 5. Camada de catálogo e Home
  - [x] 5.1 Criar `src/features/catalog` (schemas, keys, repositório) e `src/lib/pagination.ts`
    - Schemas zod com `transform` snake_case → domínio, `qk` com normalização estável, `repository.ts` (cidades, categorias, restaurantes paginados por `range`, destaques, promoções) com `RepositoryError`
    - Testes com `fakeSupabase`: mapeamento, resposta malformada, erro de rede
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 5.6_

  - [ ]* 5.2 Escrever teste de propriedade para respostas inválidas
    - **Property 36: Respostas inválidas não chegam à tela**
    - **Validates: Requirements 15.3, 15.4**

  - [ ]* 5.3 Escrever teste de propriedade para chaves de consulta
    - **Property 35: Chaves de consulta estáveis**
    - **Validates: Requirements 15.2**

  - [x] 5.4 Criar `src/features/catalog/filters.ts` e `src/test/applySpec.ts`
    - `parseRestaurantFilters`, `serializeRestaurantFilters`, `matchesFilters`, `compareBy`, `toQuerySpec`; interpretador em memória do `QuerySpec`
    - Testes unitários de filtros e ordenação
    - _Requirements: 5.2, 5.3, 5.10, 20.3_

  - [ ]* 5.5 Escrever teste de propriedade para filtros e ordenação
    - **Property 7: Filtros e ordenação coincidem com a definição semântica**
    - **Validates: Requirements 5.2, 5.3**

  - [ ]* 5.6 Escrever teste de propriedade para filtros na URL
    - **Property 12: Filtros na URL ida e volta**
    - **Validates: Requirements 5.10, 16.3**

  - [x] 5.7 Criar hooks do catálogo, `cityStore` e `LocationPicker`
    - `useCities`, `useCategories`, `useRestaurants` (infinite, 12 por página), `staleTime` de 5 min; `cityStore` em `localStorage['city:v1']`; `LocationPicker` ligado ao `TopBar`
    - _Requirements: 15.2, 5.6, 16.3, 1.2, 4.4_

  - [x] 5.8 Criar `BusinessCard`, `Section` e `CategoryRail`
    - `BusinessCard` com capa, logo, nome, categoria, nota, tempo, taxa, "Aberto"/"Fechado" em texto e ícone, selo de promoção e "Ver cardápio"; `Section` com título, subtítulo, "Ver mais" e estado vazio; `CategoryRail` (faixa no mobile, grade no desktop) com ícones Lucide
    - _Requirements: 5.4, 5.7, 3.4, 3.5, 3.6, 3.8, 3.9, 18.7_

  - [ ]* 5.9 Escrever teste de propriedade para o cartão de negócio
    - **Property 8: Cartão de negócio exibe os campos e o estado em texto**
    - **Validates: Requirements 5.4, 5.7, 18.7**

  - [x] 5.10 Criar `recentStore` de últimos vistos
    - `localStorage['recent:v1']`, máximo 12, sem duplicatas, mais recente primeiro, com validação zod
    - _Requirements: 3.10_

  - [ ]* 5.11 Escrever teste de propriedade para últimos vistos
    - **Property 4: Últimos vistos limitados e sem duplicatas**
    - **Validates: Requirements 3.10**

  - [x] 5.12 Implementar `HomePage`
    - Bloco de propósito ("Da sua cidade. Do seu jeito."), três chamadas de ação, entrada de busca central (navega a `/busca?q=`, substituída na tarefa 16.5), `CategoryRail` com as 10 categorias e seções Perto de você, Mais pedidos, Promoções do dia, Comerciantes em destaque, Recomendados e Últimos vistos; seções vazias ocultas ou com estado vazio
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 3.8, 3.9_

  - [ ] 5.13 Escrever testes de componente da Home
    - Textos do bloco de propósito, CTAs com destinos, categorias, skeleton, estado vazio e erro com repositório simulado
    - _Requirements: 3.1, 3.2, 3.4, 3.9, 16.7, 20.4_

- [ ] 6. Checkpoint - Banco de catálogo e Home
  - Executar `npm run typecheck`, `npm run lint`, `npm test -- --run`, `npm run build`, `node scripts/check-bundle.mjs` e `npm run test:sql`
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Comunidade
  - [ ] 7.1 Criar `supabase/migrations/0003_community_jobs.sql`
    - Enums, `posts`, `post_likes`, `post_saves`, `business_follows`, `post_comments` (`check` 1–500, `author_name` por trigger), `jobs`, `job_applications` (`unique`, `check` 500), contadores por trigger, `fill_business_id`, RLS, grants mínimos e índices
    - _Requirements: 14.3, 14.4, 14.5, 14.7, 14.10, 10.2, 10.12, 11.6_

  - [ ] 7.2 Estender o seed com posts e vagas
    - Posts dos 8 tipos (2 patrocinados, 1 vídeo com capa) e 6 vagas, com `is_demo`
    - _Requirements: 14.12, 10.2, 10.10_

  - [ ] 7.3 Estender `rls_experiencia.sql` para comunidade e vagas
    - Visibilidade de posts/vagas publicados de comércios ativos, isolamento de curtidas, salvos, seguidas, comentários e candidaturas, `check` de comprimento, contagens do seed
    - _Requirements: 14.7, 14.14, 10.12, 11.5, 11.6_

  - [ ] 7.4 Criar `src/features/community` (schemas e repositório)
    - Feed com cursor `(published_at, id)` em páginas de 10, filtro por tipo, comentários, curtir/salvar/seguir (e desfazer), salvos, seguidas, comércios em destaque
    - Testes com `fakeSupabase`
    - _Requirements: 10.1, 10.5, 10.6, 10.9, 10.11, 15.1, 15.3_

  - [ ] 7.5 Criar `interactions.ts` com `applyInteraction` e `commentSchema`
    - Estado otimista reversível, contador nunca negativo, comentário de 1 a 500 caracteres
    - _Requirements: 10.5, 10.6, 10.8_

  - [ ]* 7.6 Escrever teste de propriedade para interação otimista
    - **Property 28: Interação otimista é reversível**
    - **Validates: Requirements 10.5**

  - [ ] 7.7 Criar ação pendente e `LoginPrompt`
    - `pendingAction.ts` (`sessionStorage['pending-action:v1']`, validade de 15 min), `LoginPrompt`, `usePendingAction` que executa a ação uma vez após o login
    - _Requirements: 2.4, 2.5_

  - [ ]* 7.8 Escrever teste de propriedade para ação pendente
    - **Property 3: Ação pendente ida e volta**
    - **Validates: Requirements 2.4**

  - [ ] 7.9 Criar hooks da comunidade
    - `usePosts` (infinite), `usePost`, `useComments`, mutações otimistas com `onMutate`/`onError`/`onSettled` e toast de erro; chaves de dados pessoais em `['me', userId, ...]`
    - _Requirements: 10.5, 10.6, 15.2, 16.8_

  - [ ] 7.10 Criar `PostCard` e variantes
    - Cabeçalho comum (avatar, nome, horário relativo, tipo, local, rótulo "Patrocinado" acessível), variantes dos 8 tipos, `VideoPost` com capa e botão "Reproduzir vídeo", barra de ações com `aria-label` contextual
    - _Requirements: 10.2, 10.3, 10.4, 10.7, 10.10, 18.4_

  - [ ]* 7.11 Escrever teste de propriedade para o post
    - **Property 27: Post exibe campos e rótulo de patrocínio**
    - **Validates: Requirements 10.2, 10.3, 10.4, 10.7, 10.10**

  - [ ] 7.12 Implementar `CommunityPage` e `PostPage`
    - Feed com filtros por tipo, empresas em destaque, rolagem progressiva, comentários com validação e mensagem de limite, convite de login para visitante
    - _Requirements: 10.1, 10.5, 10.6, 10.8, 10.9, 2.4_

  - [ ] 7.13 Integrar "Novidades da comunidade" à Home
    - _Requirements: 3.7, 3.8_

  - [ ] 7.14 Escrever testes de componente da Comunidade
    - Visitante vê `LoginPrompt` ao curtir; reversão após falha; comentário vazio/acima de 500 rejeitado; rótulo "Patrocinado"
    - _Requirements: 2.4, 10.4, 10.5, 10.8, 20.4_

- [ ] 8. Restaurantes
  - [ ] 8.1 Implementar `RestaurantsPage` e `FilterBar`
    - Filtros (categoria, entrega/retirada, avaliação mínima, promoções, faixa de preço) e ordenação (proximidade, popularidade, tempo) sincronizados com a URL; barra sticky; páginas de 12 com "Carregar mais"; estado vazio com "Limpar filtros"; sinal `ready` para restauração de rolagem
    - _Requirements: 5.2, 5.3, 5.4, 5.6, 5.9, 5.10, 16.3_

  - [ ]* 8.2 Escrever teste de propriedade para páginas
    - **Property 11: Páginas disjuntas e completas**
    - **Validates: Requirements 5.6, 10.9**

  - [ ] 8.3 Escrever testes de componente das listagens
    - Alterar filtro altera a URL, voltar restaura, "Limpar filtros", skeleton e erro
    - _Requirements: 5.9, 5.10, 16.3, 20.4_

- [ ] 9. Página do restaurante e Sacola
  - [ ] 9.1 Estender repositório e hooks do catálogo para o restaurante
    - `getRestaurantBySlug`, `getMenu`, `getProductsByIds`, `getReviews`, posts do comércio; `staleTime` de 5 min; inexistente/inativo vira `not_found`
    - _Requirements: 6.1, 6.11, 6.12, 15.1_

  - [ ] 9.2 Criar `src/features/catalog/options.ts`
    - `validateSelection`, `toggleOption` (max 1 substitui, max > 1 bloqueia), `optionsTotalCents`, com testes unitários
    - _Requirements: 6.8, 6.9, 20.3_

  - [ ]* 9.3 Escrever teste de propriedade para adicionais
    - **Property 13: Validação de adicionais**
    - **Validates: Requirements 6.8, 6.9**

  - [ ] 9.4 Criar `src/features/cart/cart.ts`
    - `lineIdOf`, `addLine`, `replaceCart`, `setQuantity`, `removeLine`, `serializeCart`, `parseCart` (nunca lança), `priceCart`, `toOrderPayload` (sem campos monetários), com testes unitários
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6, 7.7, 20.3_

  - [ ]* 9.5 Escrever teste de propriedade para ida e volta da Sacola
    - **Property 14: Sacola ida e volta e sem valores monetários**
    - **Validates: Requirements 7.1, 7.4**

  - [ ]* 9.6 Escrever teste de propriedade para Sacola corrompida
    - **Property 15: Sacola corrompida é descartada**
    - **Validates: Requirements 7.5**

  - [ ]* 9.7 Escrever teste de propriedade para troca de restaurante
    - **Property 16: Troca de restaurante exige confirmação**
    - **Validates: Requirements 7.3, 7.2**

  - [ ]* 9.8 Escrever teste de propriedade para reconciliação com o Cardápio
    - **Property 17: Reconciliação da Sacola com o Cardápio**
    - **Validates: Requirements 7.6**

  - [ ]* 9.9 Escrever teste de propriedade para o subtotal
    - **Property 18: Subtotal vem do Cardápio**
    - **Validates: Requirements 7.7, 8.20**

  - [ ] 9.10 Criar `cartStore` e ligar `TopBar` e `CartFab`
    - `useSyncExternalStore`, gravação síncrona em `localStorage['cart:v1']` (≤ 100 ms), evento `storage` entre abas; substituir `useCartSummary` provisório com contador e total; região `aria-live`
    - _Requirements: 7.1, 7.2, 1.2, 1.3, 18.6_

  - [ ] 9.11 Criar `StickyCategoryBar`
    - Scroll spy com `IntersectionObserver` e rolagem por `animateScrollTo` (≤ 350 ms, imediata com movimento reduzido)
    - _Requirements: 6.3, 6.4, 16.9_

  - [ ] 9.12 Criar `ProductCard` e `ProductModal`
    - Foto, descrição, preço, `OptionGroupField`, observações e quantidade; "Adicionar" desabilitado com grupo pendente destacado; aviso de limite por `aria-live`; foco preso, Esc e retorno do foco
    - _Requirements: 6.6, 6.7, 6.8, 6.9, 18.1_

  - [ ] 9.13 Criar `CartSheet` e diálogo de troca de restaurante
    - Itens, quantidades, remoção, itens indisponíveis sinalizados, checkout desabilitado até remoção, confirmação para substituir a Sacola
    - _Requirements: 7.2, 7.3, 7.6, 7.7, 1.3_

  - [ ] 9.14 Implementar `RestaurantPage`
    - Capa, logo, nome, avaliação, horário, taxa, tempo e endereço; abas Cardápio, Promoções, Avaliações, Informações e Publicações; aviso "Fechado agora" com próxima abertura; página "Não encontrado"; Sacola acessível na rolagem; registro em Últimos vistos
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.10, 6.11, 6.12, 3.10_

  - [ ] 9.15 Escrever testes de componente do restaurante e da Sacola
    - `ProductModal` (foco, Esc, mínimo, máximo), `CartSheet`, troca de restaurante, aviso de fechado, slug inexistente
    - _Requirements: 6.7, 6.8, 6.9, 6.10, 6.11, 7.3, 7.6, 20.4_

- [ ] 10. Checkpoint - Comunidade, Restaurantes e Sacola
  - Executar `npm run typecheck`, `npm run lint`, `npm test -- --run`, `npm run build`, `node scripts/check-bundle.mjs` e `npm run test:sql`
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Pedidos
  - [ ] 11.1 Criar `supabase/migrations/0004_customer_data.sql` e testes de RLS
    - `addresses` (CEP de 8 dígitos, padrão único por gatilho), `favorites`, `notifications` (cliente só atualiza `read_at`), `coupons` (`cost_bearer = 'business'`, `budget_cents`, limites de uso e validade), `coupon_redemptions` (com `discount_cents`), RLS e índices
    - Estender `rls_experiencia.sql`: isolamento de endereços, favoritos e notificações, cupons públicos apenas ativos
    - _Requirements: 14.3, 14.4, 14.7, 12.8, 8.16_

  - [ ] 11.2 Criar `supabase/migrations/0005_orders.sql` e testes de RLS
    - Enums, `orders`, `order_items`, `order_events`, gatilhos de imutabilidade, gatilho de mudança de status (evento e notificação), sem `insert/update/delete` ao cliente
    - Estender `rls_experiencia.sql`: leitura própria, escrita direta negada, imutabilidade como superusuário, status gera evento e notificação
    - _Requirements: 14.8, 14.9, 8.9, 13.5, 9.6_

  - [ ]* 11.3 Escrever propriedade SQL de imutabilidade
    - Arquivo `supabase/tests/props/p21_imutabilidade.sql`
    - **Property 21: Pedidos criados são imutáveis**
    - **Validates: Requirements 8.9, 13.5, 14.9**

  - [ ] 11.4 Criar `src/features/orders` (schemas, repositório e hooks de leitura)
    - `listMyOrders`, `getOrder`, `partitionOrders`, `refetchIntervalFor`, `useOrders`, `useOrder` (intervalo de 15 s)
    - _Requirements: 9.1, 9.3, 9.6, 9.7, 15.1_

  - [ ]* 11.5 Escrever teste de propriedade para partição de pedidos
    - **Property 25: Partição de pedidos por situação**
    - **Validates: Requirements 9.1, 9.7**

  - [ ] 11.6 Adicionar `reorderToCart` a `cart.ts`
    - Partição entre itens adicionados e indisponíveis, com testes unitários
    - _Requirements: 9.4_

  - [ ]* 11.7 Escrever teste de propriedade para repetir pedido
    - **Property 26: Repetir pedido conserva os itens**
    - **Validates: Requirements 9.4**

  - [ ] 11.8 Criar `OrderCard`, `OrderTimeline` e `OrdersPage`
    - Abas Em andamento e Anteriores; cartão com restaurante, itens, total, etapa e data; linha do tempo com `aria-current="step"`; estado vazio com ação para Restaurantes
    - _Requirements: 9.1, 9.2, 9.3, 9.8_

  - [ ] 11.9 Implementar `OrderPage`
    - Acompanhamento com linha do tempo, rótulo de pedido de teste, "Repetir pedido" com toast dos indisponíveis, "Suporte" com contatos do comércio e identificador
    - _Requirements: 9.3, 9.4, 9.5, 8.2_

  - [ ] 11.10 Escrever testes de componente de Pedidos
    - Abas, estado vazio, linha do tempo, repetir pedido e suporte
    - _Requirements: 9.1, 9.4, 9.5, 9.8, 20.4_

- [ ] 12. Perfil, endereços e cupons
  - [ ] 12.1 Criar `src/features/profile` (schemas, repositório e hooks)
    - `addressSchema` (CEP normalizado para 8 dígitos), CRUD de endereços, endereço padrão, favoritos e cupons; chaves `['me', userId, ...]`
    - _Requirements: 12.2, 12.3, 12.5, 12.6, 15.1_

  - [ ]* 12.2 Escrever teste de propriedade para CEP
    - **Property 30: CEP com 8 dígitos**
    - **Validates: Requirements 12.3**

  - [ ] 12.3 Estender o seed com cupons
    - Cupons válido, expirado, esgotado e inelegível; contagem por estado no `rls_experiencia.sql`
    - _Requirements: 14.12_

  - [ ] 12.4 Implementar `ProfilePage` e subrotas
    - Seções dados, endereços (formulário), pagamentos ("Pagamento de teste", sem dados de cartão), pedidos, favoritos, notificações, seguidas, salvos, cupons (validade, regra e responsável pelo custo), configurações e sair (encerra a sessão e leva ao Início)
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.6, 12.7, 10.11_

  - [ ] 12.5 Adicionar botão de favoritar nos cartões de comércio
    - Visitante recebe `LoginPrompt`; remoção de favorito no Perfil
    - _Requirements: 2.4, 12.5_

  - [ ] 12.6 Escrever testes de componente do Perfil
    - Validação de CEP, endereço padrão, favoritos, cupons, sair
    - _Requirements: 12.2, 12.3, 12.5, 12.7, 20.3_

  - [ ]* 12.7 Escrever propriedade SQL de isolamento entre clientes
    - Arquivo `supabase/tests/props/p32_isolamento.sql`
    - **Property 32: Isolamento de dados pessoais entre clientes**
    - **Validates: Requirements 9.6, 11.5, 12.8, 14.7, 14.8**

- [ ] 13. Vagas
  - [ ] 13.1 Criar `src/features/jobs` (schemas, repositório e hooks)
    - `listJobs` (filtros por categoria e cidade), `getJob`, `applyToJob`, `listMyApplications`, `applicationSchema`; duplicidade (`23505`) tratada como estado
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 15.1_

  - [ ]* 13.2 Escrever teste de propriedade para limites de texto
    - **Property 29: Limites de texto de comentário e candidatura**
    - **Validates: Requirements 10.6, 10.8, 11.3**

  - [ ] 13.3 Implementar `JobCard`, `JobsPage` e `JobPage`
    - Empresa, cargo, cidade, categoria, "Ver mais" e "Candidatar"; estado "Candidatura enviada"; mensagem opcional até 500 caracteres; `LoginPrompt` para visitante
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 2.4_

  - [ ] 13.4 Integrar "Vagas próximas" à Home
    - _Requirements: 3.7, 3.8_

  - [ ] 13.5 Escrever testes de componente de Vagas
    - Filtros, candidatura, duplicidade e visitante
    - _Requirements: 11.2, 11.3, 11.4, 20.4_

  - [ ]* 13.6 Escrever propriedade SQL de visibilidade pública
    - Arquivo `supabase/tests/props/p33_visibilidade.sql` (cobre catálogo, posts, vagas, serviços e avaliações)
    - **Property 33: Visibilidade pública restrita a comércios ativos**
    - **Validates: Requirements 2.2, 10.12, 11.6, 14.6**

- [ ] 14. Checkpoint - Pedidos, Perfil e Vagas
  - Executar `npm run typecheck`, `npm run lint`, `npm test -- --run`, `npm run build`, `node scripts/check-bundle.mjs` e `npm run test:sql`
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Explorar, Lojas e Serviços
  - [ ] 15.1 Estender o repositório do catálogo para lojas e serviços
    - `listStores`, `getStoreBySlug`, `listServices` com filtros por categoria e cidade, páginas de 12 e hooks
    - _Requirements: 5.7, 5.8, 15.1_

  - [ ] 15.2 Implementar `ServiceCard`, `StoresPage`, `StorePage` e `ServicesPage`
    - Lojas com capa, logo, nome, categoria, avaliação e aberto/fechado; vitrine da loja com posts e vagas, sem checkout; serviços com nome, categoria, cidade e contato; estado vazio com "Limpar filtros"
    - _Requirements: 5.7, 5.8, 5.9, 5.10_

  - [ ] 15.3 Implementar `ExplorePage`
    - Agrupamento Restaurantes, Lojas, Serviços, Vagas e Comunidade com acesso direto
    - _Requirements: 5.1, 1.8_

  - [ ] 15.4 Integrar "Empresas da região" e "Serviços populares" à Home
    - _Requirements: 3.7, 3.8_

  - [ ] 15.5 Escrever testes de componente de Explorar, Lojas e Serviços
    - _Requirements: 5.1, 5.7, 5.8, 5.9, 20.4_

- [ ] 16. Busca inteligente
  - [ ] 16.1 Criar `supabase/migrations/0006_order_functions.sql` (busca e notificações)
    - `private.escape_like`, `public.search_catalog` (security invoker, parâmetros, até 5 por grupo, cidade e comércios ativos) e `public.mark_all_notifications_read`, com grants
    - Estender `rls_experiencia.sql`: termos com `%`, `_`, `\`, aspas e `;` casam literalmente; limite de grupo; só cidade e ativos
    - _Requirements: 4.2, 4.3, 4.4, 4.8, 13.4, 14.11_

  - [ ] 16.2 Criar `src/features/search` (schemas, repositório e funções puras)
    - `normalizeSearchTerm`, `groupSearchResults`, `searchCatalog` por `rpc`, hook com debounce de 300 ms
    - _Requirements: 4.1, 4.2, 4.3, 4.8, 15.1_

  - [ ]* 16.3 Escrever teste de propriedade para agrupamento
    - **Property 5: Agrupamento de busca**
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 16.4 Escrever teste de propriedade para termo literal
    - Parte TypeScript em `search`; parte SQL em `supabase/tests/props/p06_busca_literal.sql`
    - **Property 6: Termo de busca tratado como dado literal**
    - **Validates: Requirements 4.1, 4.8**

  - [ ] 16.5 Implementar `SmartSearch` e `SearchPage`
    - Combobox ARIA (setas, Enter, Esc), grupos com "Ver todos", `aria-live` com a quantidade, vazio com sugestão de categorias, erro com "Tentar novamente"; folha de tela cheia no mobile; substituir a entrada de busca da Home e do `TopBar`
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 3.3, 18.6_

  - [ ] 16.6 Escrever testes de componente da busca
    - Debounce com `vi.useFakeTimers`, mínimo de 2 caracteres, teclado, `aria-live`, vazio e erro
    - _Requirements: 4.1, 4.5, 4.6, 4.7, 20.4_

- [ ] 17. Notificações
  - [ ] 17.1 Criar `src/features/notifications` (schemas, repositório, hooks)
    - `listNotifications`, `unreadCount`, `markRead`, `markAllRead`, `formatBadge`; contador atualizado por intervalo
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 15.1_

  - [ ]* 17.2 Escrever teste de propriedade para o contador
    - **Property 31: Contador de notificações**
    - **Validates: Requirements 13.1**

  - [ ] 17.3 Implementar `NotificationsPage` e ligar o sino do `TopBar`
    - Lista da mais recente para a mais antiga, marcar como lida ao abrir e levar ao destino, "Marcar todas como lidas", estado vazio; substituir `useUnreadCount` provisório
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.6_

  - [ ] 17.4 Escrever testes de componente de Notificações
    - _Requirements: 13.1, 13.3, 13.4, 13.6, 20.4_

- [ ] 18. Sacola, Checkout e Pedido de Teste
  - [ ] 18.1 Completar `0006_order_functions.sql` com preços e pedido
    - `private.calc_commission`, `private.calc_breakdown`, `private.compute_quote`, `public.quote_order`, `public.place_test_order` (idempotência, transação única, cupom como custo do estabelecimento), `execute` só para `authenticated`, revogação de `public`/`anon`
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.12, 8.13, 8.14, 8.15, 8.16, 8.17, 14.11_

  - [ ] 18.2 Estender `rls_experiencia.sql` com as seções de pedido
    - Recálculo no backend com payload forjado, rejeições sem pedido parcial (mensagens em pt-BR), cupom, idempotência e bloco `PARITY-VECTORS-BEGIN/END` com os 12 vetores
    - _Requirements: 8.4, 8.11, 8.12, 8.13, 8.14, 8.15, 8.16, 8.17, 14.14_

  - [ ]* 18.3 Escrever propriedade SQL de paridade e invariantes de preço
    - Arquivo `supabase/tests/props/p19_precos.sql`
    - **Property 19: Paridade e invariantes do motor de preços**
    - **Validates: Requirements 8.5, 8.6, 8.7, 8.8, 8.10, 8.11**

  - [ ]* 18.4 Escrever propriedade para valores monetários ignorados
    - Parte SQL em `supabase/tests/props/p20_valores_ignorados.sql`; parte TypeScript sobre `toOrderPayload`
    - **Property 20: Valores monetários do cliente são ignorados**
    - **Validates: Requirements 8.4, 7.4**

  - [ ]* 18.5 Escrever propriedade SQL de idempotência
    - Arquivo `supabase/tests/props/p22_idempotencia.sql`
    - **Property 22: Idempotência do pedido**
    - **Validates: Requirements 8.12**

  - [ ]* 18.6 Escrever propriedade SQL de rejeições sem pedido parcial
    - Arquivo `supabase/tests/props/p23_rejeicoes.sql`
    - **Property 23: Rejeições do backend sem pedido parcial**
    - **Validates: Requirements 8.3, 8.13, 8.14, 8.17**

  - [ ]* 18.7 Escrever propriedade SQL de cupom
    - Arquivo `supabase/tests/props/p24_cupom.sql`
    - **Property 24: Cupom é custo do estabelecimento**
    - **Validates: Requirements 8.15, 8.16**

  - [ ] 18.8 Criar `src/features/pricing/pricing-parity.test.ts`
    - Ler o bloco `PARITY-VECTORS-BEGIN/END` de `supabase/tests/rls_experiencia.sql` e comparar cada vetor com `calculateOrder` (R$ 28, 50, 56 e 64 nos três modos)
    - _Requirements: 8.11, 20.2, 20.5_

  - [ ] 18.9 Estender o repositório de pedidos com cotação e criação
    - `quoteOrder`, `placeTestOrder`, chave de idempotência em `sessionStorage` ligada ao hash do payload, mapeamento de `business_rule` com `item_id`, mutações e invalidação de `['me', uid, 'orders']` e notificações
    - _Requirements: 8.3, 8.12, 8.18, 8.20, 15.1_

  - [ ] 18.10 Implementar `CheckoutPage`
    - Itens, subtotal, frete, descontos, total, endereço, pagamento simulado, tempo estimado, cupom (rejeição junto ao campo, sem bloquear) e observações; valores só do `quoteOrder` com debounce de 300 ms; rótulo "Pedido de teste (simulado, sem cobrança real)"; botão `disabled` e `aria-busy` durante o envio; sucesso esvazia a Sacola, mostra toast e navega com `replace` a `/pedidos/:id`
    - _Requirements: 8.1, 8.2, 8.15, 8.18, 8.19, 8.20, 7.6, 2.3_

  - [ ] 18.11 Escrever testes de componente do Checkout
    - Valores vindos do `quoteOrder`, botão desabilitado em envio, rótulo de pedido de teste, limpeza da Sacola, erro de regra de negócio, cupom rejeitado, item indisponível
    - _Requirements: 8.2, 8.15, 8.18, 8.19, 8.20, 20.4_

- [ ] 19. Checkpoint - Explorar, Busca, Notificações e Checkout
  - Executar `npm run typecheck`, `npm run lint`, `npm test -- --run`, `npm run build`, `node scripts/check-bundle.mjs` e `npm run test:sql`
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 20. Finalização e documentação
  - [ ] 20.1 Remover `src/features/preview`
    - Apagar `VisualPreview.tsx`, `data.ts`, `visual-preview.css` e referências; garantir que nenhuma rota ou importação os use
    - _Requirements: 15.6_

  - [ ]* 20.2 Estender os testes estáticos
    - Ausência de referências a `features/preview`, de `service_role` e de cores hexadecimais fixas em componentes
    - _Requirements: 15.6, 14.15, 17.1_

  - [ ] 20.3 Executar a verificação completa e registrar o resultado
    - `npm run typecheck`, `npm run lint`, `npm test -- --run`, `npm run build`, `node scripts/check-bundle.mjs` e `npm run test:sql`; confirmar rotas de autenticação e os 45 testes existentes
    - _Requirements: 20.1, 20.2, 20.6, 19.5_

  - [ ] 20.4 Atualizar `PROGRESSO.md` e `PROXIMOS_PASSOS.md`
    - Registrar fases concluídas, resultado dos testes SQL e próximos passos
    - _Requirements: 20.6, 20.7_

  - [ ] 20.5 Registrar decisões em `ARQUITETURA.md` e atualizar o steering
    - Atualizar `.kiro/steering/design-system.md` (barra inferior: Início, Explorar, Comunidade, Pedidos, Perfil) e `.kiro/steering/product.md` (comunidade, vagas, lojas e serviços na camada cliente)
    - D7 (grants por coluna em `businesses`), D8 (comissão sobre subtotal bruto, cupom como custo do estabelecimento), D10 (proximidade por distância ao centro), nova barra inferior e rotas
    - _Requirements: 20.7_

  - [ ] 20.6 Atualizar `.kiro/specs/roteiro-mvp/requirements.md`
    - Marcar M2 (parte pública), M3 (leitura), M4, M5 e M6 (lado cliente) como cobertos por esta spec e registrar a mudança de escopo de comunidade, vagas, lojas e serviços
    - _Requirements: 20.7_

- [ ] 21. Checkpoint final
  - Executar a verificação completa: `npm run typecheck && npm run lint && npm test -- --run && npm run build && node scripts/check-bundle.mjs && npm run test:sql`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido.
- Cada tarefa referencia requisitos específicos para rastreabilidade.
- Checkpoints garantem validação incremental, incluindo os 45 testes existentes.
- Testes de propriedade validam propriedades universais; testes unitários e de componente cobrem exemplos e casos de borda.
- Este fluxo produz apenas artefatos de planejamento; a implementação começa a partir deste plano.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.4", "1.7"] },
    { "id": 1, "tasks": ["1.3", "1.5", "1.6", "1.8", "1.10", "2.1", "2.3"] },
    { "id": 2, "tasks": ["1.9", "2.2", "2.4", "2.5", "2.6", "2.7"] },
    { "id": 3, "tasks": ["2.8", "2.9", "2.12", "2.14", "2.15"] },
    { "id": 4, "tasks": ["2.10", "2.13"] },
    { "id": 5, "tasks": ["2.11"] },
    { "id": 6, "tasks": ["2.16"] },
    { "id": 7, "tasks": ["4.1"] },
    { "id": 8, "tasks": ["4.2"] },
    { "id": 9, "tasks": ["4.3", "4.4", "5.1"] },
    { "id": 10, "tasks": ["4.5", "5.2", "5.3", "5.4", "5.8", "5.10"] },
    { "id": 11, "tasks": ["5.5", "5.6", "5.7", "5.9", "5.11"] },
    { "id": 12, "tasks": ["5.12"] },
    { "id": 13, "tasks": ["5.13"] },
    { "id": 14, "tasks": ["7.1"] },
    { "id": 15, "tasks": ["7.2"] },
    { "id": 16, "tasks": ["7.3", "7.4", "7.5", "7.7"] },
    { "id": 17, "tasks": ["7.6", "7.8", "7.9", "7.10"] },
    { "id": 18, "tasks": ["7.11", "7.12"] },
    { "id": 19, "tasks": ["7.13", "7.14"] },
    { "id": 20, "tasks": ["8.1"] },
    { "id": 21, "tasks": ["8.2", "8.3"] },
    { "id": 22, "tasks": ["9.1", "9.2", "9.11"] },
    { "id": 23, "tasks": ["9.3", "9.4"] },
    { "id": 24, "tasks": ["9.5", "9.6", "9.7", "9.8", "9.9", "9.10", "9.12"] },
    { "id": 25, "tasks": ["9.13"] },
    { "id": 26, "tasks": ["9.14"] },
    { "id": 27, "tasks": ["9.15"] },
    { "id": 28, "tasks": ["11.1"] },
    { "id": 29, "tasks": ["11.2"] },
    { "id": 30, "tasks": ["11.3", "11.4", "11.6"] },
    { "id": 31, "tasks": ["11.5", "11.7", "11.8"] },
    { "id": 32, "tasks": ["11.9"] },
    { "id": 33, "tasks": ["11.10"] },
    { "id": 34, "tasks": ["12.1"] },
    { "id": 35, "tasks": ["12.2", "12.3"] },
    { "id": 36, "tasks": ["12.4", "12.5"] },
    { "id": 37, "tasks": ["12.6", "12.7"] },
    { "id": 38, "tasks": ["13.1"] },
    { "id": 39, "tasks": ["13.2", "13.3"] },
    { "id": 40, "tasks": ["13.4", "13.5", "13.6"] },
    { "id": 41, "tasks": ["15.1"] },
    { "id": 42, "tasks": ["15.2"] },
    { "id": 43, "tasks": ["15.3", "15.4"] },
    { "id": 44, "tasks": ["15.5"] },
    { "id": 45, "tasks": ["16.1"] },
    { "id": 46, "tasks": ["16.2"] },
    { "id": 47, "tasks": ["16.3", "16.4", "16.5"] },
    { "id": 48, "tasks": ["16.6"] },
    { "id": 49, "tasks": ["17.1"] },
    { "id": 50, "tasks": ["17.2", "17.3"] },
    { "id": 51, "tasks": ["17.4"] },
    { "id": 52, "tasks": ["18.1"] },
    { "id": 53, "tasks": ["18.2", "18.9"] },
    { "id": 54, "tasks": ["18.3", "18.4", "18.5", "18.6", "18.7", "18.8", "18.10"] },
    { "id": 55, "tasks": ["18.11"] },
    { "id": 56, "tasks": ["20.1"] },
    { "id": 57, "tasks": ["20.2", "20.3"] },
    { "id": 58, "tasks": ["20.4", "20.5", "20.6"] }
  ]
}
```
