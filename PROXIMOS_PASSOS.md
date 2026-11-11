# Próximos passos

Estado completo em `AUDITORIA.md`. Roteiro técnico: Sprints 1–12 do briefing.

## Precisa da sua ação (bloqueia validação real)

1. **Aplicar as migrations no Supabase** — autorização sua. Diga se o projeto em `.env.local` é de teste ou produção.
   Ordem: `0001` → `0005` (`supabase link` + `supabase db push`, ou SQL Editor arquivo por arquivo).
   Os testes SQL (`supabase/tests`) são para o PostgreSQL local descartável; no Supabase real aplique apenas as migrations.
2. **Primeiro Master**: cadastre-se pelo app em `/cadastro`, confirme o e-mail, edite e execute `supabase/admin/bootstrap_first_master.sql` no SQL Editor. Depois: `/admin/entrar` → Segurança → cadastrar autenticador → ativar "Exigir MFA".
3. **Se o seed fictício antigo foi aplicado no remoto**: a 0003 já o esconde do público. Para apagar (irreversível, peço autorização):
   `delete from public.businesses where is_demo; delete from public.categories where is_demo; delete from public.cities where is_demo;`
4. **Auth → URL Configuration**: incluir as URLs do site publicado e de `localhost:5173` (`/entrar`, `/nova-senha`).
5. **Decisões comerciais**: provedor de pagamento (Pix + cartão, webhooks, split/repasse); serviço de rotas/mapa para distância e tempo reais.

6. **Dados institucionais** para as páginas legais (`src/config/legal.ts`): razão social, CNPJ, endereço, encarregado (DPO), e-mail de privacidade.
7. **Supabase Auth** (painel): itens de `docs/SEGURANCA.md` §3 (rate limits, senha, CAPTCHA, MFA, redirects). **Plano de backup**: confirmar o que o plano atual oferece.
8. **GitHub**: acesso para push; depois ativar branch protection exigindo o CI e os alertas de segurança do Dependabot.
9. **Deploy**: confirmar que a hospedagem aplica `public/_headers` (Cloudflare Workers Static Assets/Pages aplicam).

## Próxima execução (independente de credenciais)

- Segurança etapa 2: Storage com políticas de upload (tipo/tamanho) antes de qualquer envio de imagem/documento; validar `NOT VALID` das URLs após conferir dados remotos.
- Módulo 22 (efeito chamariz) só depois do catálogo real e do motor de preços no backend.

- Sprint 2 (restante): coordenadas e raio por cidade no painel; consulta de usuários; notificação ao comerciante sobre a análise.
- Sprint 3: painel do restaurante (cardápio, categorias, adicionais, horários, personalização com contraste validado) e página pública da loja.

## Como rodar os testes SQL (Linux)

`initdb` não roda como root. Com PostgreSQL 16 instalado:
`su postgres -s /bin/bash -c "cd <repo> && PG_BIN=/usr/lib/postgresql/16/bin node scripts/test-sql.mjs"`.
