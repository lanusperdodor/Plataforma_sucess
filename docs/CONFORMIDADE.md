# Checklist de conformidade

Classes: **IT** implementado e testado · **PI** parcialmente implementado · **P** pendente ·
**DF** dependente de fornecedor · **DJ** dependente de validação jurídica.
Este checklist **não** declara conformidade integral.

| Área | Requisito | Classe | Evidência |
|---|---|---|---|
| Segurança técnica | RLS, RBAC, autorização no backend | IT | `docs/SEGURANCA.md` §2 |
| Segurança técnica | MFA administrativo obrigatório | IT | 0006, `rls_security.sql` |
| Segurança técnica | CSP e cabeçalhos | IT / DF | `_headers`, `headers.test.ts`; confirmar no deploy |
| Segurança técnica | Rate limit login/cadastro/recuperação | DF | Supabase Auth |
| Segurança técnica | Rate limit RPCs sensíveis | IT | `rls_security.sql` §2 |
| Segurança técnica | Testes de injeção e XSS | IT | `rls_security.sql` §4, `xss.test.tsx` |
| Segurança técnica | Uploads protegidos | P | sem upload ainda |
| Proteção de dados | Política de privacidade | PI / DJ | `/privacidade`; dados institucionais pendentes |
| Proteção de dados | Inventário, bases legais, retenção | PI / DJ | `inventory.ts`, `docs/LGPD.md` |
| Proteção de dados | Direitos do titular (pedido, exportação, anonimização) | IT | `rls_security.sql` §5, Perfil e Painel |
| Proteção de dados | Política de cookies/armazenamento | IT | `/armazenamento`, `inventory.test.ts` |
| Proteção de dados | Consentimento | P (N/A hoje) | nenhum tratamento por consentimento |
| Proteção de dados | Encarregado (DPO) e canal | P | `src/config/legal.ts` |
| Transparência comercial | Termos de uso por participante | PI / DJ | `/termos` |
| Transparência comercial | Preços e taxas antes da compra | P | depende do checkout (Sprint 4) |
| Transparência comercial | Cancelamento de assinatura acessível | P | planos não cobrados ainda |
| Transparência comercial | Identificação do fornecedor | PI | estabelecimento na página; dados da plataforma pendentes |
| Transparência comercial | Sem avaliações/descontos/contadores falsos | PI | dados fictícios removidos (Sprint 1); regras nos termos |
| Pagamentos | Webhooks assinados, idempotência, sem cartão armazenado | P / DF | provedor não escolhido |
| Contratos | DPAs com operadores | DJ / DF | nenhum confirmado |
| Acessibilidade | Teclado, contraste, alvos de toque | PI | testes de componentes; sem auditoria WCAG completa |
| Licenças | Bibliotecas de produção | IT | 28 pacotes no lockfile: 26 MIT, 1 ISC, 1 0BSD (verificado em 11/11/2026); ícones Lucide (ISC) |
| Licenças | Marca, mascote, imagens | DJ | direitos do Tuca e dos vídeos a confirmar |
| IA | Transparência | IT (N/A) | nenhuma IA em uso; regra nos termos |
| Incidentes | Procedimento e fluxo ANPD | PI / DJ | `docs/OPERACAO.md`; responsáveis pendentes |
| Continuidade | Backups e restauração testada | P / DF | plano Supabase não verificado |
