# Segurança da aplicação — matriz de requisitos e evidências

Atualizado em 11/11/2026. "Testado" = teste automatizado no repositório, executado localmente
(Vitest e PostgreSQL 16 descartável). **Nada foi validado no Supabase/Cloudflare reais.**

Legenda: ✅ implementado e testado · 🟡 parcial · ⏳ pendente · 🔌 depende de configuração/fornecedor.

## 1. Auditoria inicial (antes desta etapa)

| Achado | Risco | Correção |
|---|---|---|
| Sem cabeçalhos de segurança nem CSP | XSS e clickjacking com impacto maior; tokens da sessão ficam no localStorage | `public/_headers` com CSP estrita, HSTS, nosniff, X-Frame-Options |
| Script inline em `index.html` | Impedia CSP sem `unsafe-inline` | Movido para `public/boot-guard.js` e `public/boot.css` |
| Nenhum limite de requisições nas RPCs | Spam de cadastros, abuso de ações administrativas e da exportação de dados | `private.rate_limit` (0006), resposta HTTP 429 |
| MFA administrativo desligado por padrão | Conta de admin com senha vazada = acesso total | `require_admin_mfa = true` por padrão (0006) |
| URLs de imagem sem restrição de esquema | `javascript:`/`data:` gravados por um lojista | CHECK `^https://` em logo, capa e produto (0006) |
| `safeRedirect` aceitava caracteres de controle | `/\t/evil` vira `//evil` no navegador (redirecionamento aberto) | Recusa caracteres de controle |
| Cache de consultas admin/negócio mantido após troca de usuário no mesmo aparelho | Próxima pessoa veria dados da anterior | `SessionCacheGuard` limpa `admin`, `business`, `privacy`, `me` |
| Auditoria do envio de negócio guardava o nome digitado | Texto livre em log | Removido; testes garantem logs sem texto livre |
| Sem fluxo LGPD, sem políticas, sem CI/Dependabot | Conformidade e regressões | Ver seções abaixo |

## 2. Matriz

| Requisito | Estado | Evidência | Teste |
|---|---|---|---|
| Autenticação só pelo Supabase Auth (sem sistema paralelo) | ✅ | `src/features/auth/*`, `src/pages/AuthPages.tsx` | `auth-flows.test.tsx` |
| Senha forte no cadastro e na troca | 🟡 | `features/auth/schemas.ts` (10+ caracteres, letras e números) | `schemas.test.ts`. 🔌 política no servidor: ver §3 |
| Recuperação de senha sem enumeração | ✅ | mensagem idêntica exista ou não a conta | `auth-flows.test.tsx` |
| Redirecionamento pós-login só interno | ✅ | `safeRedirect` | `auth-flows.test.tsx` (inclui `//`, `\`, tab, `javascript:`) |
| Revogar sessões em todos os aparelhos | ✅ | `signOutEverywhere` (scope global), Perfil → Privacidade | 🟡 depende do GoTrue real |
| MFA obrigatório para administradores | ✅ | 0006 `require_admin_mfa=true`; `private.admin_mfa_ok()` em toda permissão | `rls_security.sql` §1, `rls_admin.sql` §10, `AdminApp.test.tsx` |
| Ninguém se autoeleva / aprova o próprio negócio | ✅ | `grant_role`, `admin_set_staff_permission`, `admin_review_business` | `rls_admin.sql` §6, §8; controle negativo feito |
| RBAC + permissões por estabelecimento + RLS | ✅ | 0001, 0002, 0005 | `rls_foundation.sql`, `rls_experiencia.sql` |
| Operadores com menor privilégio | ✅ | começam sem permissões | `rls_admin.sql` §4 |
| Autorização no backend em toda RPC sensível | ✅ | `private.require_permission`/`require_master` em cada função | `rls_admin.sql`, `rls_security.sql` |
| SQL injection | ✅ | só funções parametrizadas; nenhuma `SECURITY DEFINER` com `EXECUTE` dinâmico | `rls_security.sql` §4 (payloads gravados literalmente + verificação estática) |
| XSS | ✅ | React escapa texto; sem `dangerouslySetInnerHTML`/`eval` | `security/xss.test.tsx` |
| CSP e cabeçalhos HTTP | ✅ / 🔌 | `public/_headers` | `security/headers.test.ts`; navegador real sem violações (7 telas). 🔌 confirmar que o deploy aplica o `_headers` |
| URLs de imagem seguras | ✅ | CHECK `^https://` (NOT VALID p/ linhas antigas) | `rls_security.sql` §3 |
| Rate limiting no servidor | ✅ / 🔌 | `private.limit_for` (cadastro de negócio, admin, privacidade) | `rls_security.sql` §2 (+ controle negativo). 🔌 login/cadastro/recuperação: limites do Supabase Auth (§3) |
| Erros sem dados internos | ✅ | `mapPostgrestError` só exibe mensagens pt-BR | `money-errors.test.ts`, repositórios |
| Segredos fora do código e do bundle | ✅ | `.env*` ignorado; só chave anon no cliente | `npm run check-secrets` (arquivos versionados + `dist/`) |
| Logs sem dados sensíveis | ✅ | auditoria guarda ids e tipos, não texto livre | `rls_security.sql` §5, `rls_admin.sql` §10 |
| Auditoria imutável | ✅ | sem políticas de escrita em `audit_logs` | `rls_foundation.sql` |
| Dependências auditadas | ✅ | `npm audit`: 0 vulnerabilidades; lockfile | CI semanal + Dependabot |
| CI antes do merge | 🟡 | `.github/workflows/ci.yml` | 🔌 exige push e branch protection no GitHub |
| Uploads (tipo/tamanho) | ⏳ | não há upload ainda | — (Supabase Storage com políticas quando existir) |
| Idempotência e webhooks assinados | ⏳ | pagamentos não existem | Sprint 6 |
| CORS | 🔌 | API é do Supabase (gerenciado); site é estático | — |
| CSRF | ✅ (N/A) | autenticação por token no cabeçalho, não por cookie | — |
| Painel do comerciante: isolamento entre negócios, cargos, colunas protegidas | ✅ | 0007 (RLS por permissão, grants por coluna, gatilhos de nome e categoria) | `rls_merchant.sql` |
| Preço: limites, auditoria de alteração, "mais vendido" só com dados | ✅ | 0007 (`product.price` na auditoria; `is_popular` não gravável) | `rls_merchant.sql` |
| Conecta: autoria, visibilidade, perfil fechado, bloqueio, suspensão | ✅ | 0008 (RLS + gatilhos) | `rls_conecta.sql` §1–7, §11 (+ controle negativo) |
| Conecta: limite anti-automação e texto duplicado | ✅ | `conecta.post` 10/10 min; duplicado em 10 min | `rls_conecta.sql` §8 |
| Moderação humana, decisão motivada, contestação, auditoria | ✅ | `admin_moderate`, `admin_resolve_appeal` | `rls_conecta.sql` §9–11 |
| Patrocínio só pela plataforma | ✅ | `is_sponsored` não gravável pelo autor | `rls_conecta.sql` §2, `PostCard.test.tsx` |
| Manipulação de preços, concorrência de pedidos, aceite simultâneo de entregas | ⏳ | pedidos/entregas não existem | Sprints 4–5 (testes obrigatórios) |

## 3. Configuração do Supabase Auth (painel — depende de você)

Não há como aplicar por migration. Conferir em Authentication:
- Confirmação de e-mail ligada; Site URL e Redirect URLs só com os domínios oficiais.
- Senha mínima 10, exigir letras e números; **Leaked password protection** ligado (se o plano permitir).
- Rate limits de login, cadastro, OTP e recuperação (padrões do Supabase; revisar valores).
- CAPTCHA (Cloudflare Turnstile) em cadastro/login/recuperação — exige adicionar o widget no app.
- MFA TOTP habilitado; expiração do JWT ≤ 1 h; rotação de refresh token ligada.

## 4. Registro de vulnerabilidades

| Id | Descrição | Gravidade | Exposição | Estado |
|---|---|---|---|---|
| V-01 | Ausência de CSP/cabeçalhos | Alta | Pública | Corrigida (pendente confirmar no deploy) |
| V-02 | RPCs sem limite de taxa | Média | Usuários autenticados | Corrigida |
| V-03 | MFA admin opcional | Alta | Equipe | Corrigida |
| V-04 | Esquema de URL livre em imagens | Média | Lojistas | Corrigida (validar linhas antigas) |
| V-05 | Redirecionamento com caracteres de controle | Baixa | Pública | Corrigida |
| V-06 | Cache de dados de outro usuário no mesmo aparelho | Média | Aparelhos compartilhados | Corrigida |
| V-07 | Tokens de sessão em localStorage (padrão supabase-js) | Média | XSS | Mitigada por CSP; risco remanescente aceito |
| V-08 | Bundle sem SRI | Baixa | — | Aceito (mesma origem) |

## 5. Dependências

`npm audit`: 0 vulnerabilidades. Desatualizadas apenas em versões maiores (React 19, TypeScript 7,
ESLint 10, jsdom 31, lucide 1.x): não atualizadas sem migração testada. Dependabot agrupa patch/minor.
