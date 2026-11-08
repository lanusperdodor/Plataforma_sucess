# Revisão local — 7 de novembro de 2026

## Executado no Windows
- Branch: feat/fundacao-fase-1; clonagem limpa a partir do GitHub.
- npm install: concluído; package-lock.json gerado.
- npm run typecheck: passou.
- npm run lint: passou.
- npm test -- --run: 24 testes passaram em 3 arquivos (pricing 14, permissions 7, schemas 3).
- npm run build: passou; aviso de bundle JS de 521,58 kB, sem bloquear o build.
- npm audit: 16 alertas (12 moderados, 2 altos, 2 críticos); há correções que exigem atualização de versões principais. Nenhum audit fix aplicado.

## Revisão estática Supabase — não executada em banco
RLS habilitado nas sete tabelas; roles privilegiados dependem de funções com verificação de master; updates de profiles e businesses limitados por coluna. Há testes pgTAP, mas apenas cinco cenários, sem cobertura completa de empresas e operações de equipe.

Pontos a validar/corrigir antes de merge:
1. INSERT de role_permissions usa UNION ALL com literais textuais para coluna enum. A resolução de tipos pode resultar em text e impedir a migration; testar e usar casts explícitos para public.member_role conforme necessário.
2. REVOKE ALL ON ALL TABLES IN SCHEMA public afeta tabelas além desta migration se o schema não estiver vazio; preferir lista explícita das sete tabelas deste módulo.
3. Ampliar testes de RLS: isolamento de empresas, leitura anônima só de lojas ativas, escrita de equipe por cargo, bloqueio de alteração de owner/status, concessão/revogação com auditoria e proibição de promoção não autorizada.
4. Definir bootstrap seguro do primeiro master e impedir perda acidental do último master; confirmar MFA antes de produção.
5. PostgreSQL, Docker e Supabase CLI não foram encontrados no PATH. Nenhuma migration foi aplicada a banco local/remoto e nenhum teste SQL foi executado.

## Outros pontos de integração
Recuperação de senha envia email, mas não foi encontrada uma tela para definir senha nova após o link. AuthProvider e login precisam de teste integrado com sessão real, falhas e troca de usuário. Esses fluxos não estão cobertos pelos testes de schemas.

## Estado preservado
Nenhum merge, push, deploy ou alteração de banco remoto. Código-fonte original preservado nesta revisão. Arquivos novos: lockfile, esta revisão e o texto de continuação. Kiro aberto no projeto; trust da pasta é decisão manual do usuário.

## Atualização — pontos 1 a 5 (Kiro, 07/11/2026)
1. Cast explícito aplicado; migration executa em PostgreSQL 18.6.
2. REVOKE restrito às sete tabelas.
3. Testes ampliados para ~70 verificações; todos passam em banco descartável; controle negativo confirma que detectam regressão.
4. `revoke_role` bloqueia remover o último master. Bootstrap e MFA continuam pendentes (exigem projeto Supabase).
5. Validação feita com embedded-postgres em %TEMP% e stub de `auth`; ainda falta Supabase real.
Audit: 0 vulnerabilidades. Recuperação de senha: tela `/nova-senha` criada e testada (cliente simulado).
