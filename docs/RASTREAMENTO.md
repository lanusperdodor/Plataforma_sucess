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
