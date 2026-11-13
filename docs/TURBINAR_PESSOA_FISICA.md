# Turbinar publicação de pessoa física — PROPOSTA (aguardando aprovação)

> Nada disto cobra ninguém ainda. Não há tabela de preços ativa nem botão de pagamento para pessoa física.

## Planos propostos
| Plano | Duração | Preço |
|---|---|---|
| Rápido | 24 horas | R$ 2,90 |
| Fim de semana | 3 dias | R$ 6,90 |
| Semana | 7 dias | R$ 12,90 |

## O que a pessoa recebe (sem promessa de engajamento)
* A publicação aparece **mais vezes no feed da cidade escolhida** (e região, se o Master ativar), sempre com o selo **"Patrocinado"**.
* Painel simples: quantas vezes apareceu e quantos cliques (contagem única por pessoa/dia, como nos anúncios de lojas).
* **Não** garantimos curtidas, comentários, seguidores, vendas ou alcance mínimo. O texto da compra diz isso antes do pagamento.

## Regras propostas
* Só publicação própria, publicada e sem denúncia aberta. Moderação igual à das lojas (o Master pode recusar antes de ativar).
* Pagamento **antes** de ativar, pelo link de pagamento (Pix/cartão) já usado na Tucaí; ativa só com o pagamento confirmado pelo gateway.
* Sem renovação automática. Limite de 1 campanha ativa por publicação e 3 por pessoa ao mesmo tempo.
* Se o Master recusar ou a publicação for ocultada pela moderação antes de começar: estorno integral. Depois de começar: sem estorno
  proporcional (proposta — você decide).
* Conteúdo político-eleitoral, de saúde com promessa de cura, apostas e golpes: proibido turbinar.

## Configuração financeira para aprovar
| Item | Valor |
|---|---|
| Receita da Tucaí por plano | 100% do preço (R$ 2,90 / R$ 6,90 / R$ 12,90) |
| Custo do gateway (estimativa Pix ~1%; cartão ~4–5%) | sai da receita da Tucaí |
| Onde aparece | Master → Financeiro → nova linha "Turbinar (pessoas)", separada das mensalidades e das entregas |
| Nota/recibo | comprovante do gateway; emissão fiscal conforme o seu enquadramento (a confirmar com o contador) |

## Como seria implementado (depois do "aprovado")
1. Migração: tabela de planos versionada (preços acima, editável só pelo Master com auditoria), campanhas de pessoa física e
   cobrança vinculada à pessoa (hoje as cobranças são só de estabelecimentos).
2. Botão "Turbinar" na própria publicação → escolher plano e cidade → aviso "sem engajamento garantido" → pagar.
3. Ativação só pelo webhook do gateway; métricas e encerramento automático no fim do período.
4. Testes de banco: sem pagamento não ativa, publicação de outra pessoa não pode, preço vem do servidor (o navegador não define valor).
