# Progresso

## Fase 1 — Fundação (parcial)

**Verificado de fato (Node 22 + TypeScript 5.9 estrito):**
- `pricing.ts`: 14 testes passando (R$ 28/50/56/64, 4+2=5+1, entrega própria, retirada, conservação de valores, snapshot).
- `permissions.ts`: 7 testes passando (bloqueio sem sessão, isolamento entre empresas, limites de cargo, master x operador).
- Typecheck estrito dos dois módulos: OK.
- Método: os arquivos `*.test.ts` reais rodaram com um shim do `vitest` sobre `node:test` em /tmp (fora do repo).

**Escrito mas NÃO verificado:**
- Frontend (Vite/React/Tailwind, auth, telas), `eslint`, `vite build`: o sandbox não tem acesso ao npm (403). Versões em `package.json` não foram conferidas no registry.
- `supabase/migrations/0001_foundation.sql` e `supabase/tests/rls_foundation.sql`: sem PostgreSQL no sandbox; nunca executados.

**Decisões assumidas (revisar):**
- Entrega própria: a taxa de R$ 1 é cobrada do restaurante (descontada do repasse).
- Comissão calculada sobre o subtotal de produtos; descontos ainda não modelados.
- Arredondamento half-up em centavos.

Ainda NÃO existe: loja, cardápio, pedidos, pagamentos, entregadores, mapa, Master. Nenhum critério de aceitação do MVP (seção 25) está cumprido.

## Validação no Windows — 07/11/2026
Instalação concluída; typecheck, lint, 24 testes Vitest e build passaram. Banco/RLS ainda não executados. Ver REVISAO_LOCAL.md para alertas de dependências e achados de revisão. Fase 1 continua parcial; nenhum merge feito.

## Fechamento local da fundação — 07/11/2026 (Kiro)
- Migration 0001: cast explícito `member_role` no INSERT com UNION ALL; REVOKE limitado às 7 tabelas do módulo; `handle_new_user`/`set_updated_at` sem EXECUTE para anon/authenticated; `revoke_role` impede remover o último master.
- Testes SQL reescritos (`supabase/tests/rls_foundation.sql`, SQL puro): ~70 verificações de escalada de papéis, isolamento entre empresas, anon só lojas ativas, colunas protegidas (status/owner/slug), equipe por cargo, auditoria imutável, master × operador. Passaram em PostgreSQL 18.6 descartável (embedded-postgres, em %TEMP%) com stub mínimo de `auth` (`supabase/tests/local_auth_stub.sql`). Controle negativo: liberar UPDATE em todas as colunas de businesses faz o teste falhar.
- Dependências: vite 8.3.6, vitest 5.1.0, @vitejs/plugin-react 6.2.1, react-router-dom 7.18.5, zod 4.6.7, @hookform/resolvers 7.0.3, tailwind 4.3.5; override `minimatch@11.0.5` só para `@typescript-eslint/typescript-estree`. `npm audit`: 0. Sem `--force`.
- Auth: nova tela `/nova-senha` (PASSWORD_RECOVERY → definir senha); AuthProvider descarta respostas de usuário anterior e expõe falha de papéis; login com aviso de e-mail não confirmado e redirect só interno; cadastro sem confirmação entra direto; perfil trata erro de carga e update com 0 linhas; logout com escopo local e erro exibido.
- Testes: 45 Vitest passando (21 novos de fluxo de auth com cliente Supabase simulado). typecheck, lint e build verdes.

Limitações: nada foi executado contra Supabase real (sem projeto). O stub de `auth` não reproduz GoTrue, JWT nem os grants padrão do Supabase.

## Prévia visual navegável — 07/11/2026
Visual priorizado pelo usuário: verde manjericão e creme. Vitrine, cardápio, sacola, checkout, pedidos e painéis de restaurante, entregador e administração em demonstração, sem operações reais. Ver PREVIA_VISUAL.md. Rotas de auth do Kiro preservadas, incluindo nova senha. Prévia responsiva verificada em navegador.


## Prévia visual Tucaí — 08/11/2026
Verificado no navegador (Edge headless, 390×844 e 1280×900): Início, Explorar, Restaurantes, Comunidade, Vagas, Pedidos, Perfil, /entrar, /cadastro, /recuperar-senha e /admin/entrar renderizam sem erro.
- Tela branca: causa real era 504 "Outdated Optimize Dep" do Vite (dependências descobertas no meio da sessão). Corrigido com `optimizeDeps.include` no vite.config e um vigia em index.html que mostra "Recarregar" se o app não iniciar.
- Prévia sem backend: quando as tabelas não existem no Supabase (PGRST205), o catálogo troca para dados locais de demonstração (`src/features/catalog/demo-data.ts`), todos `isDemo` e com "(demo)" no nome; faixa global "Prévia com dados fictícios". Erro de rede NÃO vira demonstração.
- Início: Tuca em vídeo (MP4 entregue), fundo xadrez removido em tempo real (canvas), mudo, loop, pausa acessível; com movimento reduzido mostra o PNG estático com balão.
- Abas com conteúdo e função: Explorar (atalhos por área), Restaurantes (filtros na URL), Lojas/Serviços (categoria), Comunidade (feed, filtros, curtir/salvar/seguir só na tela, turbinadas no topo com selo "Turbinado · Patrocinado"), Vagas, Pedidos/Perfil/Notificações (abertos com convite de login), Busca, Sacola.
- Login admin em /admin/entrar usa o mesmo Supabase Auth; acesso só é reconhecido com papel platform_master/operator vindo do banco. Sem senha fixa nem bypass. Painel admin não existe ainda.
- typecheck, lint, 216 testes e build passaram.

Limitações: interações da Comunidade/Vagas/Pedidos são só visuais; carregamento inicial 574 kB (meta 450 kB, Supabase no bundle inicial); migrations 0002+ não aplicadas no Supabase remoto.