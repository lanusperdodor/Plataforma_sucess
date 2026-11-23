# Revisão de segurança focada — novembro de 2026

**Como foi feita:** skills `security-audit` (Cloudflare, modo guia) e `better-auth-security` (checklist de autenticação,
aplicado ao Supabase Auth da Tucaí). Só leitura do código e testes locais (PG16 + Vitest). Nada foi testado contra a
produção. **Não é uma auditoria completa**: cobre as mudanças de 0052 a 0057, o Worker (`/api/*`) e o login.

## Achados corrigidos (0058)

| # | Gravidade | O quê | Correção |
|---|---|---|---|
| 1 | Média (disponibilidade) | `/api/geocode` sem limite: qualquer conta (cadastro grátis) podia esgotar a cota diária do serviço de mapas (~1000/dia; cada busca faz até 4 consultas). Isso derrubava, para todos, a localização das lojas, o frete por distância e as rotas. | `geocode_allow()`: 30 buscas/hora por pessoa e teto geral de 700/dia, conferidos no banco antes de consultar o serviço. Teste: `rls_cota_mapas`, `geocode.test.ts`. |
| 2 | Baixa (disponibilidade) | `/api/diagnostico/frete` é público e calcula 4 rotas reais a cada cache vazio (cache por instância do Worker). | `diagnostic_allow()`: no máximo 24 diagnósticos novos por dia; o resto sai do cache. Teste: `rls_cota_mapas`, `diagnostics.test.ts`. |

## Conferido e sem problema
- **Login por usuário** (`resolve_login`): limite de 10 tentativas a cada 15 min por usuário e mesmo custo com ou sem conta (não revela se a conta existe).
- **Recuperar senha:** mensagem genérica ("Se o e-mail existir…").
- **CSRF:** não se aplica. As chamadas usam token no cabeçalho `Authorization`, sem cookie de sessão automático.
- **XSS → roubo de sessão:** CSP `script-src 'self'`, sem `innerHTML` (regra de lint).
- **Webhook do Mercado Pago:** confere a assinatura quando o segredo está cadastrado e, mesmo sem ele, busca o pagamento na API do Mercado Pago (o corpo do aviso não é confiável).
- **Worker → banco:** funções `worker_*` exigem a chave de integração. Push sem conteúdo, só para serviços de push conhecidos.
- **Exclusão de login (0057):** só Master. Não exclui equipe nem dono de loja real. Conta real é anonimizada, não apagada, para preservar pedidos e repasses.
- **Rota com ponto de partida do aparelho (0054):** validado (Brasil e até 100 km da loja). Serve só para a tela, nunca para valores.
- **Ofertas para entregador próprio (0052):** o aceite continua atômico (quem aceitar primeiro leva).

## Precisa conferir fora do código (sem acesso daqui)
1. **Supabase → Authentication → URL Configuration:** só o domínio da Tucaí nas URLs de redirecionamento (equivale às "trusted origins").
2. **Supabase → Authentication → Rate limits** e proteção contra senhas vazadas (leaked password protection), se disponível no plano.
3. **Mercado Pago:** cadastrar o segredo do webhook em Master → Pagamentos quando ativar os pagamentos.
4. **Cloudflare:** segredos só como "Secret" (nunca como variável de texto).

## Skills instaladas nesta etapa
`security-audit` (Cloudflare), `ai-sdk` (Vercel), `better-auth-*` (6). Veja `.claude/skills/SOURCES.md`.
A Tucaí continua com Supabase Auth (sem migração para Better Auth) e sem IA. As skills ficam como referência.
