---
inclusion: always
---

# Regras comerciais APROVADAS (obrigatórias — a IA não pode alterá-las)

Valores em **centavos inteiros**. Arredondamento padrão: half-up (`Math.round`) sobre centavos, em um único ponto (`src/lib/money`).
Implementação de referência: `src/features/pricing/`. Fonte da verdade em produção: backend (Postgres/Edge Functions); o frontend apenas exibe.

## Comissão percentual (sobre o subtotal de produtos)
- subtotal <= R$ 50,00 (5000): 0%.
- subtotal > R$ 50,00: 2% sobre TODO o subtotal. (56 → 1,12; 64 → 1,28)
- É adicional à taxa de tecnologia por entrega.

## Entrega curta, entregador parceiro (padrão inicial, configurável pelo Master)
- Cliente paga 400; restaurante contribui 200; entregador recebe 500; plataforma 100. Soma 600.
- Exemplo R$ 28: cliente 3200; restaurante 2600; entregador 500; plataforma 100.
- Exemplo R$ 64: cliente 6800; restaurante 6072; entregador 500; plataforma 228 (128 comissão + 100 logística).
- Tarifas do provedor de pagamento são registradas à parte (não incluídas acima).

## Entregas longas
Não usar frete fixo de R$ 6. Tarifa por zona/distância/condições, exibida antes da confirmação. Pagamento do entregador deve estar financiado pela cobrança (cliente + restaurante) antes de confirmar.

## Entregador próprio
Frete próprio configurado à parte; restaurante paga seu entregador; plataforma cobra R$ 1 (100) por entrega gerenciada. NÃO aplicar os R$ 5 do parceiro.

## Retirada
Sem receita de entrega. Comissão percentual segue a regra acima/contrato do canal.

## Imutabilidade
Cada pedido grava um snapshot das taxas vigentes na confirmação. Alterações do Master nunca afetam pedidos já confirmados.

## Promoções
A plataforma NUNCA financia cupons. Toda campanha: responsável pelo custo (o estabelecimento), orçamento máximo, limite por cliente, nº de usos, validade, elegibilidade. Sem recompensa condicionada a avaliação no Google.
