# Próximos passos

Roteiro completo: `.kiro/specs/roteiro-mvp/requirements.md`.

## Bloqueado pelo usuário
1. Projeto Supabase de teste (plano gratuito): enviar a URL e colocar a anon key em `.env.local` (não no chat, se preferir). Em Auth → URL Configuration, incluir `http://localhost:5173/nova-senha` e `http://localhost:5173/entrar` nas Redirect URLs.
2. Com o projeto: aplicar `supabase/migrations/0001_foundation.sql` (SQL Editor ou `supabase db push`), rodar `supabase/tests/rls_foundation.sql` no SQL Editor (deve terminar com `RLS_FOUNDATION_OK`; tudo é revertido) e fazer smoke test de cadastro/recuperação com e-mail real.
3. Primeiro master: `insert into public.user_roles(user_id, role) values ('<uuid>', 'platform_master');` no SQL Editor + MFA.
4. Decisões: provedor de pagamento, tiles do mapa, nome da marca, descontos na base da comissão.

## Próxima tarefa independente
M2 Lojas: escrever a spec `lojas` e a migration 0002 (cidades, horários, tema com contraste, solicitação/aprovação de loja) com testes SQL no PostgreSQL descartável.

## Como rodar os testes SQL localmente (sem Docker)
Num diretório fora do repo: `npm i embedded-postgres pg`, iniciar um Postgres e executar, nesta ordem, `supabase/tests/local_auth_stub.sql`, `supabase/migrations/0001_foundation.sql`, `supabase/tests/rls_foundation.sql` (arquivos em UTF-8 sem BOM).

## Atualização e prioridade do usuário — 07/11/2026
A URL e chave pública do Supabase já estão em .env.local ignorado pelo Git; endpoint de Auth respondeu HTTP 200. A tabela de perfis ainda não estava disponível na consulta anterior, sem migration remota aplicada pelo Codex. Prioridade agora: revisar e refinar o visual de todas as experiências em PREVIA_VISUAL.md antes de retomar as integrações. Não refazer a prévia nem remover as rotas de autenticação.


## Comunidade — publicação turbinada (pedido do usuário, 08/11/2026)
Empresas poderão pagar para turbinar (impulsionar) uma publicação. Regras já aplicadas na prévia: a publicação turbinada sobe para o topo do feed e sempre leva o selo "Turbinado · Patrocinado". Hoje é só visual: sem cobrança, sem painel da empresa.
Pendente de decisão: preço e duração do impulsionamento (definidos e auditados pelo Master), limite de turbinadas por tela, alcance por cidade/raio, e cobrança via provedor de pagamento (M8). A plataforma não financia o impulsionamento.