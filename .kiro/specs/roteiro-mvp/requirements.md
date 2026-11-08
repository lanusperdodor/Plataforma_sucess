# Roteiro mestre do MVP

Cada módulo vira uma spec própria em `.kiro/specs/<modulo>/` (requirements → design → tasks) ao ser iniciado. Este arquivo é o índice: escopo, dependências, critérios de aceite (CA) e tarefas pequenas. Regras comerciais: `.kiro/steering/business-rules.md` (não alterar aqui).

Definição de "concluído" para qualquer módulo: migrations + testes SQL de autorização passando em banco descartável; typecheck, lint, Vitest (`--run`) e build verdes; fluxo funcionando contra o projeto Supabase de teste; E2E para fluxos críticos; PROGRESSO/PROXIMOS_PASSOS atualizados.

Legenda: [x] feito e verificado · [~] parcial · [ ] pendente · 🔒 bloqueado por decisão/recurso do usuário

## Dependências

```
M1 Fundação ─┬─ M2 Lojas ─ M3 Cardápio ─ M4 Cliente ─ M5 Checkout ─ M6 Pedidos ─┬─ M7 Entregas ─ M9 Rastreamento
             │                                       ▲                        └─ M8 Pagamentos 🔒
             └─ M10 Master (aprovações já em M2; taxas antes de M5) ─────────────┘
M11 Planos/presencial depende de M2, M8, M10 · M12 integração depende de todos
```

---

## M1 Fundação — auth, perfis, papéis, permissões (spec `fundacao`)
CA: AC1–AC5 da spec `fundacao`; multi-papel; isolamento por empresa; recuperação de senha completa.
- [x] 1.1 Migration 0001 corrigida (cast enum, REVOKE restrito, último master protegido, funções internas sem EXECUTE público)
- [x] 1.2 Testes SQL de autorização (escalada, isolamento, equipe, auditoria) em PostgreSQL 18 descartável + controle negativo
- [x] 1.3 npm audit zerado com versões compatíveis e validação completa
- [x] 1.4 Fluxos auth com testes de integração (login, cadastro, logout, nova senha, perfil, troca de usuário)
- [ ] 1.5 🔒 Projeto Supabase de teste: aplicar 0001, rodar testes SQL no Supabase real, smoke test de auth com e-mail real
- [ ] 1.6 🔒 Bootstrap do primeiro `platform_master` via SQL no painel + MFA habilitado
- [ ] 1.7 E2E (Playwright) de cadastro → login → perfil → logout contra o Supabase de teste

## M2 Lojas/restaurantes
Requisitos: solicitação de cadastro de loja (cria `businesses` pending via função), aprovação/suspensão pelo Master com auditoria, cidade (`cities`, começando em Itaú de Minas/MG), endereço e coordenadas, horários semanais + exceções (America/Sao_Paulo), tema (cores com contraste AA validado no banco e no front), logo/capa no Storage com política por empresa, equipe por convite com cargos da matriz RBAC.
CA: loja pendente invisível ao público; lojista não altera status/owner; contraste < 4.5:1 rejeitado; membro da loja A não edita B; "aberto agora" correto em fuso de SP, incluindo virada de dia.
- [ ] 2.1 Spec `lojas` (requirements/design/tasks)
- [ ] 2.2 Migration: `cities`, colunas de loja, `business_hours`, `business_hour_exceptions`, `business_themes`, função `request_business`, `approve_business`/`suspend_business` (master/operator, auditadas)
- [ ] 2.3 Função `is_open_at(business, ts)` + testes SQL de horários
- [ ] 2.4 Validação de contraste (TS puro + check no banco) com testes
- [ ] 2.5 Storage: bucket `business-media`, políticas por empresa, tipo/tamanho
- [ ] 2.6 Convites de equipe (`business_invites`, aceitar via função) + testes
- [ ] 2.7 Telas: solicitar loja, configurações, horários, tema com prévia, equipe

## M3 Cardápio
Requisitos: categorias ordenáveis, produtos (preço em centavos, imagem, descrição, disponibilidade/pausa), grupos de opções (mín/máx, obrigatórios) e itens com acréscimo, estoque simples opcional.
CA: só `menu.manage` escreve; público lê apenas loja ativa e itens disponíveis; preço nunca vem do cliente no pedido.
- [ ] 3.1 Spec `cardapio` · 3.2 Migration + RLS + testes SQL · 3.3 Validação de opções (função pura + SQL) · 3.4 Editor do cardápio (lojista) · 3.5 Upload de imagens otimizadas

## M4 Experiência do cliente (spec `ui-ux`, etapas 1–4)
Requisitos: seleção de cidade, home regional, busca, categorias horizontais, filtros (aberto agora, entrega/retirada, taxa), página da loja com barra sticky, favoritos, barra inferior mobile, estados preservados ao voltar.
CA: paginação progressiva; skeletons; teclado e leitor de tela; `prefers-reduced-motion`; dados reais.
- [ ] 4.1 Componentes base e layout mobile · 4.2 Home + busca/filtros (consulta paginada/índices) · 4.3 Página da loja · 4.4 Favoritos (RLS própria) · 4.5 Code splitting por rota (bundle hoje 546 kB)

## M5 Carrinho e checkout
Requisitos: carrinho por loja; endereços do cliente; modalidade retirada / entrega própria / entrega parceira; cotação de frete por zona/distância antes de confirmar; motor financeiro no backend (porta de `pricing.ts` para SQL/Edge Function com os mesmos casos de teste); snapshot imutável das taxas.
CA: valores 28/50/56/64 idênticos entre TS e backend; frete parceiro só confirma se entregador financiado; alteração de taxa pelo Master não muda pedido confirmado; cotação expira.
- [ ] 5.1 Spec `checkout` · 5.2 `fee_schedules` versionadas (só Master, auditadas) · 5.3 `delivery_zones` + cotação · 5.4 Função `quote_order` e `place_order` (idempotency key) · 5.5 Testes de paridade TS × SQL · 5.6 Telas carrinho/endereço/checkout

## M6 Pedidos
Requisitos: máquina de estados (placed → accepted → preparing → ready → out_for_delivery/picked_up → delivered; cancelamentos com motivo), transições por função com autorização por papel, histórico, painel do restaurante com aviso sonoro configurável, acompanhamento do cliente, Realtime.
CA: transição inválida rejeitada no banco; cliente só vê os próprios pedidos; loja só os seus; envio duplo não cria dois pedidos.
- [ ] 6.1 Spec `pedidos` · 6.2 Tabelas `orders`, `order_items`, `order_events` + RLS · 6.3 `transition_order` + testes de cada transição · 6.4 Realtime com filtros autorizados · 6.5 Painel lojista · 6.6 Acompanhamento cliente · 6.7 E2E pedido completo (retirada)

## M7 Entregas
Requisitos: cadastro e aprovação de entregador parceiro; disponibilidade; oferta com valor, retirada e distância; aceite atômico (um só vence); entrega própria por `courier_own`; estados; comprovação (código de confirmação na entrega).
CA: dois aceites simultâneos → um sucesso; entregador não vê dados do cliente antes do aceite além do necessário; repasse de R$ 5 só no parceiro.
- [ ] 7.1 Spec `entregas` · 7.2 `courier_profiles` + aprovação · 7.3 `delivery_offers` + `accept_offer` com lock + teste de concorrência · 7.4 Código de entrega · 7.5 Painel do entregador

## M8 Pagamentos (sandbox) 🔒 provedor
Requisitos: PIX/cartão via provedor escolhido; Edge Function cria cobrança; webhook com assinatura verificada; idempotência por evento; conciliação; estornos; tarifas do provedor em tabela separada; ledger de repasses.
CA: webhook repetido não duplica; assinatura inválida rejeitada; soma do ledger = cobrança; nenhum dado de cartão armazenado.
- [ ] 8.1 🔒 Decisão do provedor · 8.2 Spec `pagamentos` · 8.3 Ledger + tarifas · 8.4 Edge Functions cobrança/webhook · 8.5 Conciliação e estorno · 8.6 Testes com payloads assinados de sandbox

## M9 Rastreamento
Requisitos: MapLibre; posição enviada só com entrega ativa; leitura só pelo cliente do pedido, loja e Master; aviso de localização desatualizada; retenção limitada (ex.: apagar após 7 dias).
CA: fora de entrega ativa a escrita é negada; terceiro não lê; job de retenção testado.
- [ ] 9.1 🔒 Provedor de tiles (gratuito) · 9.2 `courier_locations` + RLS + retenção · 9.3 Envio com throttle · 9.4 Mapa do cliente com interpolação

## M10 Administração Master/operador
Requisitos: aprovações (lojas, entregadores), gestão de papéis, planos/taxas versionadas, auditoria pesquisável, visão financeira; MFA obrigatório (AAL2 exigido nas funções de Master) antes de produção.
CA: operador não altera taxas nem papéis; toda ação gera auditoria; sem MFA, funções de Master negam.
- [ ] 10.1 Spec `master` · 10.2 Exigência de `aal2` nas funções sensíveis · 10.3 Telas de aprovação/papéis/taxas/auditoria · 10.4 Relatórios financeiros

## M11 Planos e presencial
Requisitos: planos Delivery R$ 79/mês e Presencial + Delivery R$ 99/mês; assinatura em sandbox; recursos presenciais (cardápio por QR/NFC na mesa, link para avaliação Google sem recompensa condicionada) liberados pelo plano.
CA: nenhuma cobrança real; recurso presencial bloqueado sem o plano; troca de plano auditada.
- [ ] 11.1 Spec `planos` · 11.2 `plans`/`subscriptions` · 11.3 QR/NFC/link · 11.4 Cobrança recorrente sandbox (depende de M8)

## M12 Integração ponta a ponta e preparação de deploy
- [ ] 12.1 E2E: cliente, lojista, entregador, Master · 12.2 Revisão de RLS completa (todas as tabelas) · 12.3 Acessibilidade (axe + teste manual) · 12.4 Responsividade e Core Web Vitals · 12.5 Rate limiting/antifraude nas Edge Functions · 12.6 Documentação de operação · 12.7 Configuração Cloudflare Pages (sem publicar) · 12.8 🔒 Autorização para publicar

## Futuros (fora do MVP, só arquitetura)
Shopping, serviços, rede social, vagas, publicidade: novas tabelas/features com `business_id` + RLS, sem alterar o núcleo. Não iniciar sem decisão do usuário.

## Decisões pendentes do usuário
1. Projeto Supabase de teste (URL e anon key no `.env.local` do usuário) — bloqueia 1.5–1.7 e a validação real de todos os módulos.
2. Provedor de pagamento (ex.: Mercado Pago, Asaas, Pagar.me, Stripe) — bloqueia M8/M11.
3. Provedor de tiles do mapa — bloqueia M9.
4. Nome da marca; descontos na base da comissão; quem paga a taxa de R$ 1 da entrega própria (assumido: restaurante).
