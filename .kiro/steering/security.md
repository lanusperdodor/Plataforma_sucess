---
inclusion: always
---

# Segurança e privacidade

- RLS habilitado em TODA tabela do schema `public`; sem política = sem acesso. Nunca `USING (true)` em tabela privada.
- Nenhum segredo no repositório/frontend. `.env` ignorado; só `.env.example` com placeholders.
- Papéis `platform_master`/`platform_operator` nunca são autoatribuídos: concedidos apenas por função de backend com auditoria (`audit_logs`). Sem senha administrativa fixa; Master exige MFA (Supabase Auth) antes de produção.
- Cadastro público só cria `customer`. Entregador/lojista exigem aprovação administrativa.
- Operações financeiras: idempotentes, auditáveis, valores em centavos, webhooks com assinatura validada, tarifas do provedor em registro separado. Nunca guardar dados completos de cartão.
- Rastreamento: só durante entrega ativa, visível ao cliente do pedido; retenção limitada.
- Uploads: validar tipo/tamanho, buckets com política por empresa.
- LGPD: minimização de dados, exportação/exclusão de conta, consentimento claro. Não usar termos de aceite para excluir responsabilidades irrenunciáveis.
- Rate limiting e proteção antifraude em Edge Functions antes do lançamento.
