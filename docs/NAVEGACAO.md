# Navegação e rastreamento do entregador (0037 + 0046)

## O que existe
| Função | Como |
|---|---|
| Mapa na tela do entregador | MapLibre GL JS + mapas OpenFreeMap (dados OpenStreetMap). Escuro no tema escuro, claro no tema claro. |
| GPS em tempo real | Geolocation API (`watchPosition`, alta precisão). O aparelho mostra a posição exata; o servidor recebe a cada ~20 s (ou antes, se andou >60 m). |
| Marcador do veículo | Moto, carro ou bicicleta (do cadastro), com seta da direção quando em movimento. |
| Rota pelas ruas | No servidor (Worker `/api/rota`): openrouteservice (padrão) ou OSRM **próprio** (`ROUTING_PROVIDER=osrm` + `OSRM_URL`). Até a loja e depois até o cliente. |
| Distância e tempo | Total da etapa (rota) e restante (posição projetada na rota). Sem rota: linha reta, marcada como "aproximado". |
| Recálculo fora da rota | 2 posições seguidas a mais de 250 m da rota → nova rota (máx. 1 a cada 2 min; 6 por entrega; teto diário). |
| Instruções de conversão | Em português, do openrouteservice (`instructions`, `language=pt`) ou geradas a partir das manobras do OSRM. Só o entregador da etapa lê (`courier_route_steps`). |
| Cliente ao vivo | Pista com a motinha (posição real; aproximada ~100 m até a coleta, para privacidade do entregador) + tempo real (canal privado por pedido). |
| Ofertas | Valor, distância da entrega (pelas ruas, calculada no servidor), estimativa até a loja (só se o GPS já estiver autorizado; nada é enviado), Aceitar/Rejeitar. |
| Falhas | Sem GPS / permissão negada, sem internet (aviso; GPS continua), rota não encontrada (aviso + rota no OpenStreetMap). |

**Valores financeiros** (frete, ganho, taxa) continuam vindo só da distância calculada no servidor (0040). A navegação não altera valores.

## Provedores gratuitos — limites e licenças (verificar periodicamente)
| Provedor | Custo | Limites | Licença / obrigação |
|---|---|---|---|
| OpenFreeMap (mapa) | grátis, sem chave | sem limite publicado; projeto mantido por doações | atribuição OpenStreetMap (já exibida no mapa) |
| OpenStreetMap (dados) | grátis | — | ODbL: "© OpenStreetMap contributors" |
| openrouteservice (rotas, padrão) | grátis (plano Standard) | ~2.000 rotas/dia e ~40/min por chave | atribuição; o software é livre e pode ser instalado no próprio servidor |
| OSRM (rotas, opcional) | software livre (BSD-2) | sem limite no **seu** servidor | **o servidor público de demonstração (router.project-osrm.org) é proibido em produção** e é bloqueado no código |

Para usar OSRM próprio sem custo de licença é preciso um servidor (ex.: VPS ou nível gratuito de nuvem com memória suficiente para o mapa de MG/Brasil). Hospedagem pode ter custo — não foi contratada.

## Limitações de um app web (PWA)
* **Tela bloqueada / app em segundo plano:** os navegadores (Android e principalmente iPhone) pausam o GPS e o envio. A tela fica acesa
  enquanto a navegação está aberta (Wake Lock, quando o aparelho permite) e o entregador é avisado. Rastreamento contínuo em segundo plano
  exige app nativo (ex.: Capacitor/React Native com permissão "localização em segundo plano" e serviço em primeiro plano no Android).
* **Voz:** não há navegação por voz (pode ser feita depois com a Web Speech API do próprio aparelho, gratuita).
* **Precisão:** depende do GPS do celular; dentro de prédios pode variar dezenas de metros.

## Testes
* Banco: `supabase/tests/rls_rastreamento.sql`, `rls_broadcast.sql`, `rls_navegacao.sql` (instruções só do entregador, ofertas com distância, compatibilidade).
* Worker: `src/worker/routes.test.ts`, `steps.test.ts` (openrouteservice e OSRM, português, banco sem a 0046).
* App: `geo.test.ts` (próxima conversão, estimativas), `LiveLocation.test.tsx` (GPS → mapa, conversão, distância/tempo, rota não encontrada, sem internet), `CourierArea.test.tsx` (ofertas).
