# Spec Fundação — Design

## Frontend
Vite + React + TS estrito; Tailwind v4 com tokens CSS; React Router; TanStack Query; `AuthProvider` (sessão Supabase) + `useAuth`; `RequireAuth`/`RequirePermission`.
Permissões em `src/features/permissions` (função pura `can(ctx, permission, businessId?)`) espelhando a matriz do banco.
Preços em `src/features/pricing` (função pura `calculateOrder`) — espelho para exibição; o backend recalcula e é a fonte da verdade.

## Banco (migração `0001_foundation.sql`)
- Enums: `app_role`, `member_role`.
- `profiles` (1:1 auth.users, criada por trigger `handle_new_user`).
- `user_roles(user_id, role)` papéis globais; trigger dá `customer`.
- `businesses` (mínimo: id, name, slug, owner_id, status) — expandida em spec futura.
- `business_members(business_id, user_id, member_role)`.
- `permissions(code)` e `role_permissions(member_role, permission)` — matriz RBAC.
- `audit_logs` (somente inserção via funções SECURITY DEFINER).
- Funções `SECURITY DEFINER` com `search_path` fixo: `has_role`, `is_business_member`, `has_business_permission`.
- RLS: perfil só do dono (+ staff plataforma leitura); `user_roles` leitura própria, escrita só via backend; `business_members` visível para membros da mesma empresa, escrita só por owner da empresa; `audit_logs` leitura apenas master.
- Concessão de papéis privilegiados: função `grant_role` restrita a `platform_master`, grava auditoria.

## Decisões
- Papéis globais separados de papéis por empresa (multi-tenant e multi-papel).
- Autorização duplicada no cliente só para UX.
- Sem tabela de senhas/credenciais; Master exige MFA antes de produção.
