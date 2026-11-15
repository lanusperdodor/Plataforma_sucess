# Aviso de corrida nova e rota por etapa

## Aviso de corrida (0053)
- **App aberto:** a cada corrida nova, toca um bip (gerado no navegador), o celular vibra e aparece o aviso fixo "Nova corrida!". A lista atualiza a cada 10 s.
- **App em segundo plano ou fechado:** Web Push (padrão aberto e gratuito).
  - O Worker roda a cada minuto (Cron Trigger) e chama `worker_offer_pushes`.
  - Cada push vai **sem conteúdo**: nenhum dado do pedido passa pelo serviço de push.
  - O celular mostra "Nova corrida disponível" e, ao tocar, abre `/entregador`.
- **Quem é avisado:** os mesmos que veriam a oferta (aprovado, Online, mesma cidade, sem entrega em andamento, sem ter recusado), uma vez por rodada.
- **Ativar:**
  1. No painel Master → Pagamentos, use **Gerar chaves**.
  2. No Cloudflare, crie os Secrets `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`.
  3. Também é preciso o Secret `PAYMENTS_INTEGRATION_KEY`.
- **Limites:**
  - iPhone: só com a Tucaí adicionada à Tela de Início (iOS 16.4 ou mais novo).
  - Com o app fechado, o som é o da notificação do celular.
  - O aviso pode chegar até ~1 min depois da corrida (o Cron roda a cada minuto; a oferta vale 5 min).

## Rota por etapa (0054)
- **Um botão só, no mesmo lugar:**
  - **Traçar rota até o restaurante:** sai da posição atual do celular (GPS). Sem GPS, usa o endereço cadastrado do entregador.
  - Depois de **Peguei o pedido**, vira **Traçar rota até o cliente:** sai do local cadastrado do restaurante.
- **Sem cálculo automático:** a rota não é mais traçada sozinha, nem em sequência.
- **Validação do ponto de partida:** Brasil e até 100 km da loja.

## Entregador próprio já logado (0052, 0055)
- Vê o botão **Ficar online** direto, sem a página de cadastro.
- Na 1ª vez, confirma celular, veículo e termos na mesma tela. A cidade vem da loja.
- Online, recebe as corridas de todas as lojas da cidade, além das entregas da própria loja.
