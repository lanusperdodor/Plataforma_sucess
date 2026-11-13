# Rastreamento de entregas no mapa

> **Status: implementado no código e testado localmente (migration 0037).** Ainda NÃO aplicado no Supabase de
> produção nem publicado. Para ligar: aplicar `supabase/admin/apply_all_migrations.sql`, criar a chave do provedor de
> rotas como segredo do Worker e publicar. Sem a chave, o mapa funciona com loja, destino e entregador; só a linha da
> rota (e a previsão) não aparecem.

## Como funciona (resumo)

1. O entregador toca em **Compartilhar localização ao vivo** (o navegador pede a permissão). O app envia a posição REAL
   do GPS a cada ~20 s (antes, no mínimo 8 s, se andou mais de 60 m) para `courier_track_location`. Só o entregador
   atribuído, só durante a entrega. Fica gravada só a última posição (sem histórico).
2. O banco grava e incrementa `delivery_tracking_ticks` (sem coordenadas). O Supabase Realtime avisa quem pode ver o pedido
   (RLS = `can_view_order`). O app chama `delivery_tracking()`, que devolve a posição já arredondada para quem pergunta:
   cliente ~100 m até a coleta e ~10 m depois; loja só até a coleta e sem o destino do cliente; Master com auditoria.
3. O mapa (MapLibre GL JS + estilo OpenFreeMap) mostra loja, destino, rota e a motinha. Ao chegar posição nova, a moto
   desliza até ela em ~1,2 s; sem posição nova ela PARA. Acima de 60 s: "aguardando nova posição"; acima de 2 min:
   "Localização desatualizada" e a moto fica cinza. Distância e previsão só aparecem com rota calculada, posição recente
   e entregador a até 250 m da rota (previsão = distância restante ÷ velocidade média que o provedor calculou para a rota).
4. Rota: o app do entregador pede `POST /api/rota` ao Worker na primeira posição de cada etapa e quando ele sai da rota
   (2 leituras seguidas a mais de 250 m, no mínimo 2 min entre pedidos). O banco autoriza (`route_request`): no máximo 6
   rotas por entrega, 1 a cada 90 s e 500 por dia na plataforma (`private.routing_daily_limit`). A chave do provedor fica
   só no Worker. Clientes e loja nunca disparam cálculo de rota: só leem a rota gravada.
5. Navegação: botão **Rota até a loja / Rota até o cliente no Google Maps** abre `google.com/maps/dir/` com o destino
   (coordenada quando existe, senão o endereço digitado). Gratuito, sem chave: quem calcula e guia é o próprio Google Maps.
6. Fim: entrega concluída, cancelada, liberada ou troca de entregador apagam posição e rotas (gatilhos); posição parada
   há 30 min some pela varredura `sweep_tracking()` (pg_cron a cada 5 min, se habilitado). O entregador também pode parar.
7. Destino: o cliente pode tocar em **Usar minha localização** no pedido (antes de sair para entrega) para marcar o ponto.
   Sem isso, o mapa mostra loja e entregador e o Google Maps navega pelo endereço digitado.

## Limites honestos

* **Tela bloqueada / segundo plano:** navegadores móveis (Chrome Android, Safari iOS) suspendem ou reduzem o GPS de
  páginas em segundo plano. Não foi validado funcionamento contínuo com a tela bloqueada e ele NÃO é prometido. O app
  pede a tela acesa (Screen Wake Lock, quando o aparelho suporta) e avisa o entregador. Rastreio contínuo com tela
  bloqueada exige app nativo (ou PWA com recursos que hoje não são garantidos no iOS).
* Precisão depende do aparelho (mostrada ao entregador). Posição antiga (mais de 10 min) ou no futuro é recusada.

## Custos e escolha das tecnologias (pesquisa de 13/11/2026 — confirme nas páginas oficiais antes de contratar)

| Peça | Escolhida | Custo | Alternativa |
|---|---|---|---|
| Biblioteca do mapa | **MapLibre GL JS 6.16.0** (BSD-3) | grátis, sem conta | Mapbox GL JS: 50.000 carregamentos/mês grátis, depois cobrado por carregamento; exige conta e token |
| Mapa (tiles) | **OpenFreeMap** (dados OpenStreetMap) | grátis, sem chave e sem limite publicado; serviço "como está" | Mapbox (dentro dos 50 mil carregamentos), MapTiler, ou tiles próprios (PMTiles no Cloudflare R2) se o OpenFreeMap sair do ar |
| Rotas | **openrouteservice** (padrão do Worker) | plano gratuito ~2.000 rotas/dia (uso comercial: confirmar os termos do plano) | **Mapbox Directions**: 100.000 requisições/mês grátis, depois cobrado; trocar com `ROUTING_PROVIDER=mapbox` |
| Endereço → coordenada | **não usado** (cliente marca pelo GPS; Google Maps navega pelo endereço) | grátis | Geocodificação Mapbox: temporária (100 mil/mês grátis) **não pode ser gravada**; a permanente é paga desde a 1ª |
| Navegação do entregador | **Google Maps URLs** (`/maps/dir/`) | grátis, sem chave | Routes API do Google (paga, com chave) — desnecessária |
| Tempo real | Supabase Realtime (já contratado) | dentro do plano | — |

Com os limites acima, o custo recorrente esperado para a operação regional é **zero**. Pontos a confirmar pela Tucaí:
* Termos do Mapbox: resultados de APIs Mapbox podem ter restrições de exibição fora de mapas Mapbox e de armazenamento.
  Por isso o padrão é openrouteservice; usar Mapbox Directions só depois de conferir os termos (www.mapbox.com/legal).
* OpenFreeMap e openrouteservice exigem atribuição (OpenStreetMap / openrouteservice), exibida no canto do mapa.

## Configuração (nada disso é feito automaticamente)

1. Criar conta gratuita em openrouteservice.org e gerar a chave.
2. `npx wrangler secret put ORS_API_KEY` (ou `ROUTING_PROVIDER=mapbox` + `npx wrangler secret put MAPBOX_TOKEN`).
3. Aplicar as migrations (0037) no Supabase. Opcional: habilitar pg_cron para a varredura.
4. CSP: `connect-src` já inclui `https://tiles.openfreemap.org`. Trocar o estilo (`VITE_MAP_STYLE_URL`) exige liberar o novo
   domínio em `src/worker/securityHeaders.ts` e `public/_headers`.
5. Limite diário: alterar `private.routing_daily_limit()` por migration.

## Testes

* `supabase/tests/rls_rastreamento.sql`: permissões por perfil (cliente, outro cliente, funcionário, outro estabelecimento,
  entregador parceiro, entregador próprio, Master auditado), arredondamento, horário inválido, bilhete de rota de uso
  único, limite de rotas, apagamento ao concluir e ao parar.
* `src/worker/routes.test.ts`: chave só no Worker, token do usuário repassado ao banco, recusa sem chamar o provedor.
* `src/features/rastreamento/geo.test.ts` e `src/components/map/DeliveryTracking.test.tsx`: distância restante, previsão
  só com dados confiáveis, posição desatualizada para a moto, envio a cada ~20 s.
* Não testado ainda: GPS real em celular na rua, tiles reais do OpenFreeMap e chave real do openrouteservice (o ambiente
  de desenvolvimento não acessa esses serviços). Teste de campo: com as contas de homologação, Entregador 1 aceita um
  pedido do Cliente 1 e compartilha a localização andando; Cliente 1 acompanha no celular.

---

# Arquitetura original (proposta anterior, mantida para referência)

# Rastreamento de entregadores em tempo real — arquitetura proposta

> **Status: somente documentação.** Nada aqui foi aplicado: nenhuma migration, nenhum serviço de mapas,
> nenhuma coleta de GPS. O fluxo atual (pedido → aceite → preparo → oferta antecipada → coleta → código de
> 4 dígitos → entregue) continua sendo a prioridade e não depende deste módulo.

## 1. Objetivo e limites

| Requisito | Como será atendido |
|---|---|
| Entregador autoriza compartilhar localização durante entrega ativa | Consentimento explícito por entrega (botão "Compartilhar minha localização"), revogável a qualquer momento |
| Envio adaptativo | Frequência conforme movimento/bateria (seção 4) |
| Cliente vê posição aproximada | Coordenada arredondada (~50 m) e marcador do veículo (moto/bicicleta/carro, de `couriers.vehicle`) |
| Rota e previsão de chegada | Serviço de roteamento (seção 6), só quando houver posição recente |
| Loja acompanha a aproximação para coleta | Somente equipe com `orders.view` do estabelecimento do pedido, e só até a coleta |
| Master consulta entregas ativas | Painel Master, com acesso auditado |
| Fim do rastreamento | Ao entregar, cancelar ou liberar a entrega a posição é apagada e o canal deixa de receber dados |

**Proibido:** coordenadas fictícias apresentadas como reais; animar o marcador sem GPS real; expor
entregador offline ou sem entrega autorizada; guardar histórico detalhado sem necessidade.

## 2. Modelo de dados (migration futura, ex.: `00xx_rastreamento.sql`)

```sql
-- só a ÚLTIMA posição de cada entrega ativa (uma linha por entrega; sem histórico)
create table public.delivery_locations (
  order_id     uuid primary key references public.deliveries(order_id) on delete cascade,
  courier_id   uuid not null references auth.users(id) on delete cascade,
  lat          numeric(8,5) not null,   -- ~1 m; o cliente recebe versão arredondada
  lng          numeric(8,5) not null,
  accuracy_m   smallint,                -- precisão informada pelo aparelho
  heading      smallint,
  speed_kmh    smallint,
  recorded_at  timestamptz not null,    -- hora do GPS
  received_at  timestamptz not null default now()
);
-- consentimento por entrega (prova para LGPD)
create table public.delivery_location_consents (
  order_id uuid primary key references public.deliveries(order_id) on delete cascade,
  courier_id uuid not null, granted_at timestamptz not null default now(), revoked_at timestamptz
);
```

* Gravação **apenas por RPC** `courier_share_location(_order, _lat, _lng, _accuracy, _heading, _speed, _recorded_at)`:
  exige entregador ativo, entrega `accepted`/`picked_up` atribuída a ele, consentimento vigente,
  coordenadas dentro do Brasil, `recorded_at` não futuro e no máximo 1 gravação a cada 3 s (`private.limit_for`).
  Faz `upsert` (sempre uma linha) — não cresce com o tempo.
* Leitura **apenas por RPC** `delivery_location_for(_order)`:
  * cliente dono do pedido → lat/lng arredondados a 3 casas (~100 m) antes da coleta e 4 casas (~10 m) depois;
  * equipe da loja (`orders.view`) → só enquanto `deliveries.status = 'accepted'` (aproximação para coleta);
  * Master → com `private.audit('tracking.view', …)`;
  * devolve também `recorded_at` e `stale = recorded_at < now() - interval '2 minutes'`.
* Retenção: trigger em `deliveries` apaga `delivery_locations` quando status vira `delivered`/`cancelled`
  ou o entregador libera a entrega; varredura (`sweep_deliveries`) apaga linhas com mais de 30 min sem
  atualização. **Nenhum histórico de trajeto é guardado.** Se um dia houver necessidade (disputa, seguro),
  criar trilha resumida com retenção curta (ex.: 7 dias) e base legal documentada antes.

### RLS
* `delivery_locations` e `delivery_location_consents`: RLS ligada, `revoke all` de `anon`/`authenticated`;
  tudo passa pelas RPCs `security definer` acima (mesmo padrão de `my_delivery`/`courier_my_deliveries`).

## 3. Tempo real

* **Supabase Realtime Broadcast** em canal privado por pedido (`tracking:<order_id>`), com
  *Realtime Authorization* (políticas em `realtime.messages`) permitindo assinar somente a quem passa
  na mesma regra de `delivery_location_for`. A RPC de gravação publica a posição já **arredondada** no canal
  (`realtime.send`), então o banco nunca envia a coordenada precisa ao cliente.
* Reserva: se o canal cair, a tela consulta `delivery_location_for` a cada 15 s (mesmo padrão do `LiveUpdates`).
* Não usar `postgres_changes` na tabela (enviaria a coordenada completa e dependeria de RLS de leitura direta).

## 4. Coleta no aparelho do entregador

* Web: `navigator.geolocation.watchPosition` com `enableHighAccuracy` só durante entrega ativa e com a tela
  aberta. **Limite importante:** navegadores suspendem o GPS com a aba em segundo plano ou a tela bloqueada
  (principalmente iOS Safari). A tela deve avisar: "Mantenha a Tucaí aberta para o cliente acompanhar".
* Frequência adaptativa: parado (< 5 km/h) → a cada 30 s; em movimento → a cada 5–10 s ou a cada 30 m
  deslocados; bateria < 20 % (Battery API, quando existir) → a cada 30 s; descartar leituras com precisão > 100 m.
* Sem GPS ou permissão negada: nada é enviado; o cliente vê o status do pedido normalmente.
* Futuro app (React Native/Capacitor) com serviço em segundo plano e notificação persistente resolve o limite
  do navegador; a API (RPC + canal) permanece a mesma.

## 5. Experiência no acompanhamento do pedido (`OrderPage`)

* Cartão "Entregador a caminho" acima da linha do tempo, ocupando a largura da tela no celular.
* Marcador conforme `couriers.vehicle` (`moto`, `bike`, `carro`) com ícones da própria Tucaí (SVG, dois temas);
  mapa com estilo claro/escuro do provedor.
* **Sem posição recente** (`stale` ou nenhuma leitura): mapa sem marcador animado e texto
  "Última atualização às 14:32 — o entregador pode estar sem sinal". Nada de interpolar/animar posições.
* Previsão de chegada só quando o roteamento devolver tempo; caso contrário, não mostrar ETA.
* Loja: mini-mapa no card do pedido em "Pedidos recebidos" enquanto aguarda a coleta.
* Master: lista de entregas ativas com última atualização (sem mapa contínuo por padrão).

## 6. Provedores e custos potenciais (valores de referência; confirmar na contratação)

| Opção | Mapa | Rota/ETA | Observações |
|---|---|---|---|
| **OpenStreetMap + MapLibre GL** com tiles próprios ou de terceiro (ex.: MapTiler, Stadia) | Gratuito a baixo custo; terceiros têm cota grátis e cobram por mil carregamentos | **OSRM** ou **Valhalla** auto-hospedado (servidor ~US$ 20–80/mês para o Brasil) ou API paga de terceiros | Menor custo em escala; exige operar o servidor de rotas ou contratar terceiro. Respeitar a política de uso dos tiles públicos do OSM (não usar em produção sem servidor próprio/contratado) |
| **Mapbox** | Cota gratuita mensal de carregamentos de mapa web; acima disso cobrança por mil | Directions API com cota gratuita e cobrança por mil requisições | Boa qualidade e estilos claro/escuro prontos |
| **Google Maps Platform** | Cota/crédito mensal gratuito; depois cobrança por mil carregamentos | Routes API cobrada por requisição | Melhor cobertura de endereços no Brasil; costuma ser a mais cara em volume |

Estimativa de uso para dimensionar: cada pedido acompanhado ≈ 1 carregamento de mapa para o cliente
(+1 para a loja) e 1 cálculo de rota a cada 1–2 min durante ~20 min (≈ 10–20 requisições). Reduzir custo:
calcular rota só quando o entregador se desloca > 300 m, e ETA no servidor (Worker) com cache curto.
Chaves de mapas/rotas ficam no Worker (rotas) ou restritas por domínio (mapa); **nunca** chave privada no bundle.

## 7. LGPD e segurança

* Base legal: execução do contrato de entrega (cliente) e consentimento específico do entregador para o
  compartilhamento durante a corrida; registrar o consentimento (`delivery_location_consents`).
* Minimização: só última posição, arredondada para o cliente, apagada ao fim da entrega.
* Transparência: atualizar a Política de Privacidade (seção de entregadores) antes de ativar.
* Direitos do titular: a exportação de dados do entregador inclui consentimentos; não há trajeto a exportar.
* Abuso: limite de gravação por RPC, validação de coordenadas, auditoria de acesso do Master.
* Manutenção global (0030): o rastreamento continua permitido para entregas já em andamento.

## 8. Pontos de integração no código atual

| Onde | O que muda |
|---|---|
| `supabase/migrations/00xx_rastreamento.sql` | tabelas, RPCs, trigger de limpeza, políticas do Realtime |
| `src/features/courier/repository.ts` | `shareLocation`, `grantLocationConsent`, `revokeLocationConsent` |
| `src/pages/courier/CourierArea.tsx` (`ActiveDelivery`) | botão de consentimento, `watchPosition` adaptativo, aviso de segundo plano |
| `src/features/orders/repository.ts` + `src/pages/OrderPage.tsx` | `deliveryLocationFor`, cartão de mapa, estado "última atualização" |
| `src/pages/merchant/OperationsTabs.tsx` (`OrdersTab`) | mini-mapa até a coleta |
| `src/pages/admin/AdminOrders.tsx` | entregas ativas com última atualização |
| `src/worker/` | (opcional) `/api/rotas/eta` com chave do provedor e cache |
| `docs/` | política de privacidade e homologação |

## 9. Ordem sugerida (quando autorizado)

1. Migration + testes RLS (cliente/loja/outro cliente/entregador alheio/Master/sem consentimento/entrega encerrada).
2. Coleta no entregador (sem mapa) e exibição textual "última atualização" no pedido.
3. Mapa com provedor escolhido em modo de teste; depois rota/ETA.
4. Homologação com aparelhos reais (Android Chrome, iOS Safari) — validar perda de GPS em segundo plano.
