# Arquitetura (resumo)

Ver `.kiro/steering/architecture.md`. Decisões:
- Papéis globais (`user_roles`) separados de papéis por empresa (`business_members`) → multi-papel + multi-tenant.
- Autorização real em RLS; `can*` no frontend é só UX.
- Papéis privilegiados só via `grant_role` (master) com auditoria; cadastro público cria apenas `customer`.
- Preço/comissão: `src/features/pricing` espelha a regra; o backend recalculará e gravará snapshot no pedido.
