# Frete por distância (migration 0040)

Tabela aprovada pelo responsável (editável no Painel Master → Financeiro → Frete por distância; cada mudança vira uma
nova versão e os pedidos antigos guardam a deles):

| Distância por ruas | Entregador | Tucaí | Custo total | Cliente | Loja | Subsídio da Tucaí |
|---|---|---|---|---|---|---|
| até 1,5 km | R$ 5 | R$ 1 | R$ 6 | R$ 4 | R$ 2 | — |
| 1,5 a 3 km | R$ 6 | R$ 1 | R$ 7 | R$ 5 | R$ 2 | — |
| 3 a 5 km | R$ 7 | R$ 1 | R$ 8 | R$ 5 | R$ 2 | R$ 1 |
| acima de 5 km | sem entrega parceira até o Master criar uma faixa | | | | | |

* Custo total = ganho do entregador + taxa da Tucaí. A loja paga até R$ 2; o cliente o restante até R$ 5; o que faltar
  é subsídio explícito da Tucaí (gravado em cada pedido e mostrado no Financeiro). O entregador nunca recebe menos.
* Frete grátis (Gestão → Entregas): cliente R$ 0 e a loja paga o custo total da corrida.
* Entrega própria da loja: não usa as faixas (frete da loja; R$ 1 da Tucaí cobrado da loja).

## Como o valor é calculado (sem confiar no navegador)
1. No checkout o cliente toca em "Calcular frete pelo meu local" (GPS).
2. O Worker (`POST /api/frete`) confere o cliente no Supabase Auth, lê o ponto da loja e calcula a rota **por ruas**
   (openrouteservice ou OSRM próprio; chave só no Worker) e grava uma cotação de 15 min com a **chave de integração**.
3. Ao criar o pedido, um gatilho no banco aplica a última cotação válida do próprio cliente para aquela loja, em
   centavos, e grava distância, faixa, valores e subsídio no pedido (imutáveis). A cotação só vale uma vez.
4. Sem cotação: se "exigir cálculo da distância" estiver ligado no Master, o pedido é recusado; senão vale a 1ª faixa.

## Acerto do dinheiro
* O cliente paga na entrega; o entregador entrega o valor total à loja.
* Na cobrança mensal da Tucaí à loja: comissão + frete pago pelos clientes nas entregas parceiras + parte da loja +
  R$ 1 por entrega própria (`private.store_charge_total`). A receita da Tucaí continua sendo comissão + taxa por entrega
  (`private.platform_fees`), menos o subsídio.
* A Tucaí paga o entregador pela carteira (saque após 7 dias, 0036).

## Para ligar em produção
1. Aplicar `supabase/admin/apply_all_migrations.sql` (0036 a 0040).
2. Painel Master → Pagamentos: gerar a chave de integração e salvar no Worker: `npx wrangler secret put PAYMENTS_INTEGRATION_KEY`.
3. Chave gratuita do openrouteservice: `npx wrangler secret put ORS_API_KEY` (ou `ROUTING_PROVIDER=osrm` + `OSRM_URL`).
4. As lojas com entregador parceiro precisam ter o endereço marcado no mapa (latitude/longitude).
5. Depois de testar, ligar "Exigir cálculo da distância" no Master.

Testes: `supabase/tests/rls_frete.sql`, `src/worker/freight.test.ts`, `src/pages/CheckoutPage.test.tsx`.
