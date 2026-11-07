# Spec Fundação (Fase 1) — Requirements

## Escopo
Projeto base, design tokens, integração segura com Supabase, autenticação, perfis, papéis/permissões, regras de preço (núcleo financeiro puro).

## Requisitos funcionais
1. **RF1 Cadastro**: usuário cria conta com e-mail/senha; recebe automaticamente apenas o papel `customer`.
2. **RF2 Login/Logout/Recuperação de senha** via Supabase Auth.
3. **RF3 Perfil**: cada usuário vê e edita apenas o próprio perfil (nome, telefone, cidade preferida).
4. **RF4 Papéis**: um usuário pode ter vários papéis (customer, business_owner, business_staff, courier_partner, courier_own, service_provider, platform_operator, platform_master).
5. **RF5 Permissões**: papéis de empresa vivem em `business_members`; permissões são avaliadas por empresa (isolamento multi-tenant).
6. **RF6 Rotas protegidas** no frontend por papel/permissão (apenas UX; autorização real é RLS).
7. **RF7 Motor de preços**: comissão 2% > R$ 50, frete parceiro 4+2=5+1, entregador próprio R$ 1, retirada, snapshot imutável (ver business-rules).

## Não funcionais
- RLS em todas as tabelas; nenhum autoatribuição de papel privilegiado; sem segredos no frontend.
- Valores em centavos inteiros; TypeScript estrito; lint/build/testes verdes.

## Critérios de aceitação
- AC1: novo usuário tem exatamente o papel `customer` e um `profiles` criado por trigger.
- AC2: usuário comum não consegue inserir em `user_roles`/`business_members` nem alterar papéis (RLS + testes SQL documentados).
- AC3: membro da empresa A não lê dados da empresa B.
- AC4: pedidos de R$ 28/50/56/64 geram os valores exatos da regra comercial.
- AC5: `typecheck`, `lint`, `test`, `build` passam.
