# Pagamentos (Mercado Pago)

Recebimento das mensalidades e demais cobranças das empresas pelo **Checkout Pro** (Pix, cartão e boleto).

## Segurança
- Access Token e assinatura dos avisos ficam em `private.payment_gateway` (schema privado; nenhum papel da API lê). O painel mostra só os 4 últimos dígitos.
- Quem usa o token é o Worker (`src/worker/payments.ts`), com a **chave de integração**: gerada no Painel Master (mostrada uma vez), guardada como hash no banco e como segredo `PAYMENTS_INTEGRATION_KEY` no Cloudflare.
- A baixa só acontece depois de o Worker consultar o pagamento na API do Mercado Pago (aprovado, em BRL, com a cobrança como referência) e o banco conferir o valor. O mesmo pagamento nunca baixa duas vezes.
- Com a assinatura secreta cadastrada, avisos sem `x-signature` válida são recusados.

## Configurar (Painel Master → Pagamentos)
1. Mercado Pago Developers → aplicação Checkout Pro → Credenciais (teste `TEST-`, depois produção `APP_USR-`).
2. Colar Public Key e Access Token, salvar e ativar.
3. Gerar a chave de integração e cadastrar no Cloudflare: Workers & Pages → plataforma-sucess → Settings → Variables and Secrets → Secret `PAYMENTS_INTEGRATION_KEY`.
4. No Mercado Pago → Webhooks: URL `https://<site>/api/pagamentos/webhook`, evento Pagamentos; copiar a assinatura secreta para o painel.
5. Testar conexão; gerar uma mensalidade no Financeiro e pagar com usuário de teste.

## Fluxo
- Lojista: painel → **Plano** → “Pagar com Mercado Pago”. Master: Financeiro → cobrança → **Link de pagamento** (para enviar pelo WhatsApp).
- Aprovado → cobrança paga (forma Pix/cartão/boleto) e, se for mensalidade, plano renovado por 1 mês. Tudo na auditoria.
