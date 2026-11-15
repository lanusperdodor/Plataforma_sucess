# Plano com débito automático (0049)

Fluxo:
1. **Cliente cadastra a empresa** (Cadastrar negócio): preenche os dados, o endereço (vira ponto no mapa sozinho) e escolhe o plano
   — Padrão R$ 79/mês ou Premium R$ 99/mês (valor sempre da tabela `plans` no banco).
2. Ao enviar, vai para o **Mercado Pago autorizar o cartão** (Assinaturas / preapproval). O Mercado Pago cobra todo mês sozinho.
3. Cada mensalidade aprovada chega pelo aviso (webhook), é conferida na API do Mercado Pago e vira uma **cobrança paga** no
   Financeiro, estendendo o plano por 1 mês. O mesmo pagamento nunca é registrado duas vezes.
4. A equipe Tucaí aprova o cadastro normalmente. **Se recusar, a assinatura é cancelada** no Mercado Pago.
5. O dono vê a situação e pode **cancelar** em Gestão → Configurações → Débito automático do plano (ou assinar depois, se pulou).

## Para ativar (manual)
1. Master → Pagamentos: cadastrar Access Token e chave do webhook do Mercado Pago e ativar.
2. Gerar a chave de integração e gravar o segredo `PAYMENTS_INTEGRATION_KEY` no Worker.
3. No painel do Mercado Pago (Suas integrações → Webhooks): URL `https://<seu domínio>/api/pagamentos/webhook` com os eventos
   **Pagamentos** e **Planos e assinaturas** (assinaturas e pagamentos autorizados).
4. Aplicar o SQL até a 0049.

Sem o passo 1–2, o cadastro da empresa funciona e mostra "Pagamento online ainda não está ativo" (nada é cobrado).
